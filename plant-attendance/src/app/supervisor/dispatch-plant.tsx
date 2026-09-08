import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  SectionList,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy"
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import { API_URL, STORAGE_KEYS } from "../../constants/config";
import { C } from "../../constants/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmpType = "OFFICE" | "PPSUPERVISOR";

// DRAFT (office editing Dispatch/Empty Material Details, not yet visible to
// supervisor) -> PENDING (sent, visible in supervisor's queue, but STILL
// editable by office for Dispatch/Empty Material Details until the
// supervisor completes it) -> COMPLETED (supervisor has finished loading
// entries; Dispatch/Empty Material Details are now frozen for office, who
// must fill Transporter + Weight/Freight Details for the first time) ->
// FINALIZED (office has filled Transporter + Weight/Freight; locked for
// everyone).
type DispatchStatus = "DRAFT" | "PENDING" | "COMPLETED" | "FINALIZED";

type MstItem = {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  wgtconv: string | null;
};
type Party = { ledcd: string; lednm: string | null; areanm: string | null };
type Depo = { untcd: string; untnm: string; untshnm: string | null };

// One length/width/height/extra arrangement for an item's loading table.
type LoadingEntryRow = {
  key: string;
  entryId?: string;
  length: string;
  width: string;
  height: string;
  extra: string;
};

type DispatchItemRow = {
  key: string;
  itemId?: string;
  itmcd: string;
  itmnm: string;
  qty: string;
  wgtconv: string; // weight per box, from mstitm — carried alongside the row so the loading table can compute weight without a second lookup
  avgWtPerBox: string; // supervisor-entered actual avg weight per box, distinct from wgtconv (catalog rate)
  loadingEntries: LoadingEntryRow[];
};

type EmptyItemRow = {
  key: string;
  itemId?: string;
  itmcd: string;
  itmnm: string;
  qty: string;
};

type Session = {
  SESSION_ID: string;
  DISPATCH_TO: string;
  PARTY_CD: string;
  PARTY_NM: string;
  VEHICLE_NO: string | null;
  BILTY_NO: string | null;
  TRANSPORTER: string | null;
  DRIVER_NAME: string | null;
  DRIVER_NO: string | null;
  GRR_NO: string | null;
  GROSS_WT: string | null;
  TARE_WT: string | null;
  TOTAL_WT: string | null;
  TOTAL_FREIGHT: string | null;
  ADVANCE: string | null;
  BALANCE: string | null;
  STATUS: DispatchStatus;
  CREATEDAT?: string;
  items: {
    ITEM_ID: string;
    ITMCD: string;
    ITMNM: string;
    QTY: string;
    FULL_BOX_WT: string | null;
    AVG_WT_PER_BOX: string | null;
    loadingEntries?: {
      ENTRY_ID: string;
      LENGTH: number;
      WIDTH: number;
      HEIGHT: number;
      EXTRA: number;
    }[];
  }[];
  emptyItems: { ITEM_ID: string; ITMCD: string; ITMNM: string; QTY: string }[];
};

type PDFItemData = {
  itmnm: string;
  qty: string;
  totalBoxes: number;
  weight: number;
  grossWeight: number;
  entries: LoadingEntryRow[];
};

type PDFData = {
  dispatchTo: string;
  partyNm: string;
  createdAt: string;
  vehicleNo: string;
  biltyNo: string;
  transporter: string;
  driverName: string;
  driverNo: string;
  grrNo: string;
  grossWt: string;
  tareWt: string;
  totalWt: string;
  totalFreight: string;
  advance: string;
  balance: string;
  items: PDFItemData[];
  emptyItems: EmptyItemRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const blankLoadingEntry = (): LoadingEntryRow => ({
  key: uid(),
  length: "",
  width: "",
  height: "",
  extra: "",
});

const blankRow = (): DispatchItemRow => ({
  key: uid(),
  itmcd: "",
  itmnm: "",
  qty: "",
  wgtconv: "",
  avgWtPerBox: "",
  loadingEntries: [],
});

const blankEmpty = (): EmptyItemRow => ({
  key: uid(),
  itmcd: "",
  itmnm: "",
  qty: "",
});

const STATUS_META: Record<
  DispatchStatus,
  { label: string; bg: string; border: string; text: string }
> = {
  DRAFT: { label: "Draft", bg: "#F1F5F9", border: "#CBD5E1", text: "#475569" },
  PENDING: { label: "Pending", bg: "#FEF3C7", border: "#FCD34D", text: "#B45309" },
  // Labelled "Loaded" rather than "Completed" — office still owes
  // Transporter + Weight/Freight Details at this point, so "Completed"
  // would misleadingly suggest nothing is left to do.
  COMPLETED: { label: "Loaded", bg: "#DBEAFE", border: "#93C5FD", text: "#1D4ED8" },
  FINALIZED: { label: "Finalized", bg: "#DCFCE7", border: "#86EFAC", text: "#15803D" },
};

const OFFICE_FOOTER_TEXT: Record<DispatchStatus, string> = {
  DRAFT: "Tap to continue editing →",
  PENDING: "Sent — tap to review or edit →",
  COMPLETED: "Supervisor has loaded this — tap to add transporter & weight details →",
  FINALIZED: "Tap to view finalized challan →",
};

// Box count for one loading entry. Any of length/width/height that is not
// strictly greater than 0 (blank, or a typed 0) is dropped from the
// multiplication rather than zeroing the whole row — only positive dimensions
// participate. Extra is added on top and may be negative or blank (= 0).
const computeEntrySubtotal = (entry: LoadingEntryRow): number => {
  const factors = [entry.length, entry.width, entry.height]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  const product = factors.length
    ? factors.reduce((a, b) => a * b, 1)
    : 0;
  const extra = entry.extra.trim() === "" ? 0 : Number(entry.extra) || 0;
  return product + extra;
};

// Sum of all loading-entry subtotals for an item = total box count.
const computeItemTotalBoxes = (entries: LoadingEntryRow[]): number =>
  entries.reduce((sum, e) => sum + computeEntrySubtotal(e), 0);

// Item weight = total boxes * weight-per-box (mstitm.wgtconv).
const computeItemWeight = (
  entries: LoadingEntryRow[],
  wgtconv: string,
): number => {
  const perBox = Number(wgtconv) || 0;
  return computeItemTotalBoxes(entries) * perBox;
};

// Gross weight = total boxes * supervisor-entered avg weight per box.
// Distinct from computeItemWeight, which uses the catalog wgtconv rate —
// this uses the actual measured value the supervisor enters per item.
const computeItemGrossWeight = (
  entries: LoadingEntryRow[],
  avgWtPerBox: string,
): number => {
  const perBox = Number(avgWtPerBox) || 0;
  return computeItemTotalBoxes(entries) * perBox;
};

const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) return "0";
  // Trim to at most 3 decimals, drop trailing zeros — matches Decimal(18,3) precision.
  return (Math.round(n * 1000) / 1000).toString();
};

const fmtDateTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
};

// ─── PDF Generator ────────────────────────────────────────────────────────────

const generateAndSharePDF = async (data: PDFData) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemBlocks = data.items
    .filter((it) => it.itmnm)
    .map((it) => {
      const entryRows = it.entries
        .map((e) => {
          const sub = computeEntrySubtotal(e);
          return `
          <tr>
            <td class="center">${e.length || "—"}</td>
            <td class="center">${e.width || "—"}</td>
            <td class="center">${e.height || "—"}</td>
            <td class="center">${e.extra || "0"}</td>
            <td class="center"><strong>${fmtNum(sub)}</strong></td>
          </tr>`;
        })
        .join("");

      return `
      <div class="item-block">
        <div class="item-block-title">${it.itmnm} <span class="item-qty">(${it.qty})</span></div>
        ${
          entryRows
            ? `<table class="loading-table">
                 <thead>
                   <tr>
                     <th class="center">L</th>
                     <th class="center">W</th>
                     <th class="center">H</th>
                     <th class="center">Extra</th>
                     <th class="center">Boxes</th>
                   </tr>
                 </thead>
                 <tbody>${entryRows}</tbody>
               </table>`
            : `<div class="no-data">No loading entries recorded</div>`
        }
        <div class="item-totals">
          <span>Total Boxes: <strong>${fmtNum(it.totalBoxes)}</strong></span>
          <span>Weight: <strong>${fmtNum(it.weight)} kg</strong></span>
          <span>Gross Weight: <strong>${fmtNum(it.grossWeight)} kg</strong></span>
        </div>
      </div>`;
    })
    .join("");

  const grandTotalWeight = data.items.reduce((s, it) => s + it.weight, 0);
  const grandTotalGrossWeight = data.items.reduce(
    (s, it) => s + it.grossWeight,
    0,
  );
  const grandTotalBoxes = data.items.reduce((s, it) => s + it.totalBoxes, 0);

  const emptyRows = data.emptyItems
    .filter((r) => r.itmcd)
    .map(
      (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.itmnm}</td>
        <td class="center">${r.qty}</td>
      </tr>`,
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
          font-size: 13px;
          color: #1e293b;
          padding: 36px;
          background: #fff;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          padding-bottom: 18px;
          border-bottom: 3px solid #3b82f6;
        }
        .company-name {
          font-size: 24px;
          font-weight: 800;
          color: #1e40af;
          letter-spacing: -0.5px;
        }
        .doc-label {
          font-size: 13px;
          color: #64748b;
          margin-top: 4px;
          font-weight: 600;
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
          margin-top: 10px;
          letter-spacing: 0.4px;
        }
        .badge-depo  { background: #dbeafe; color: #1d4ed8; }
        .badge-party { background: #fef3c7; color: #b45309; }
        .meta {
          text-align: right;
          font-size: 12px;
          color: #64748b;
          line-height: 1.8;
        }
        .meta strong { color: #334155; }
        .section { margin-bottom: 24px; }
        .section-title {
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
          padding-bottom: 6px;
          border-bottom: 1px solid #e2e8f0;
        }
        .party-name {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 2px;
        }
        .party-created {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 600;
          margin-bottom: 18px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        thead tr { background: #f1f5f9; }
        th {
          padding: 9px 12px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.7px;
          border-bottom: 2px solid #e2e8f0;
        }
        td {
          padding: 10px 12px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
        }
        tr:last-child td { border-bottom: none; }
        tr:nth-child(even) td { background: #f8fafc; }
        .center { text-align: center; }
        .item-block {
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid #e2e8f0;
        }
        .item-block:last-child { border-bottom: none; margin-bottom: 0; }
        .item-block-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 8px;
        }
        .item-qty { color: #64748b; font-weight: 600; }
        .loading-table th, .loading-table td { padding: 6px 10px; }
        .item-totals {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          margin-top: 8px;
          font-size: 12px;
          color: #475569;
        }
        .item-totals strong { color: #1e293b; }
        .grand-totals {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 32px;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 2px solid #cbd5e1;
          font-size: 13px;
          color: #334155;
        }
        .grand-totals strong { color: #0f172a; font-size: 15px; }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px 32px;
        }
        .info-item label {
          font-size: 10px;
          color: #94a3b8;
          text-transform: uppercase;
          font-weight: 700;
          display: block;
          margin-bottom: 3px;
          letter-spacing: 0.5px;
        }
        .info-item span {
          font-size: 13px;
          color: #1e293b;
          font-weight: 600;
        }
        .no-data {
          color: #94a3b8;
          font-style: italic;
          font-size: 12px;
          padding: 10px 0;
        }
        .footer {
          margin-top: 36px;
          padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          font-size: 11px;
          color: #94a3b8;
          text-align: center;
        }
        .sig-row {
          display: flex;
          justify-content: space-between;
          margin-top: 48px;
          padding-top: 8px;
        }
        .sig-box {
          width: 160px;
          text-align: center;
          border-top: 1px solid #94a3b8;
          padding-top: 6px;
          font-size: 11px;
          color: #64748b;
        }
      </style>
    </head>
    <body>

      <!-- Header -->
      <div class="header">
        <div>
          <div class="company-name">Plant App</div>
          <div class="doc-label">Dispatch Challan</div>
          <div class="badge ${data.dispatchTo === "DEPO" ? "badge-depo" : "badge-party"}">
            ${data.dispatchTo === "DEPO" ? "Own Depo" : "Direct to Party"}
          </div>
        </div>
        <div class="meta">
          <div><strong>Date:</strong> ${dateStr}</div>
          <div><strong>Time:</strong> ${timeStr}</div>
        </div>
      </div>

      <!-- Section A: Dispatch Details -->
      <div class="section">
        <div class="section-title">A. Dispatch Details</div>
        <div class="party-name">${data.partyNm || "—"}</div>
        <div class="party-created">Created: ${data.createdAt}</div>
        ${itemBlocks || `<div class="no-data">No items added</div>`}
        <div class="grand-totals">
          <span>Total Boxes: <strong>${fmtNum(grandTotalBoxes)}</strong></span>
          <span>Total Weight: <strong>${fmtNum(grandTotalWeight)} kg</strong></span>
          <span>Total Gross Weight: <strong>${fmtNum(grandTotalGrossWeight)} kg</strong></span>
        </div>
      </div>

      <!-- Transport Details -->
      <div class="section">
        <div class="section-title">Transport Details</div>
        <div class="info-grid">
          <div class="info-item">
            <label>Vehicle No.</label>
            <span>${data.vehicleNo || "—"}</span>
          </div>
          <div class="info-item">
            <label>Bilty No.</label>
            <span>${data.biltyNo || "—"}</span>
          </div>
          <div class="info-item">
            <label>Driver Name</label>
            <span>${data.driverName || "—"}</span>
          </div>
          <div class="info-item">
            <label>Driver No.</label>
            <span>${data.driverNo || "—"}</span>
          </div>
          <div class="info-item">
            <label>GRR No.</label>
            <span>${data.grrNo || "—"}</span>
          </div>
          <div class="info-item">
            <label>Transporter</label>
            <span>${data.transporter || "—"}</span>
          </div>
        </div>
      </div>

      <!-- Weight & Freight Summary -->
      <div class="section">
        <div class="section-title">Weight &amp; Freight Summary</div>
        <div class="info-grid">
          <div class="info-item">
            <label>Gross Weight</label>
            <span>${data.grossWt ? data.grossWt + " kg" : "—"}</span>
          </div>
          <div class="info-item">
            <label>Tare Weight</label>
            <span>${data.tareWt ? data.tareWt + " kg" : "—"}</span>
          </div>
          <div class="info-item">
            <label>Total Weight</label>
            <span>${data.totalWt ? data.totalWt + " kg" : "—"}</span>
          </div>
          <div class="info-item">
            <label>Total Freight</label>
            <span>${data.totalFreight ? "₹" + data.totalFreight : "—"}</span>
          </div>
          <div class="info-item">
            <label>Advance</label>
            <span>${data.advance ? "₹" + data.advance : "—"}</span>
          </div>
          <div class="info-item">
            <label>Balance</label>
            <span>${data.balance ? "₹" + data.balance : "—"}</span>
          </div>
        </div>
      </div>

      <!-- Section B: Empty Material -->
      <div class="section">
        <div class="section-title">B. Empty Material Details</div>
        ${
          emptyRows
            ? `<table>
               <thead>
                 <tr>
                   <th style="width:36px">#</th>
                   <th>Item Name</th>
                   <th class="center" style="width:80px">Qty</th>
                 </tr>
               </thead>
               <tbody>${emptyRows}</tbody>
             </table>`
            : `<div class="no-data">No empty material items</div>`
        }
      </div>

      <!-- Signatures -->
      <div class="sig-row">
        <div class="sig-box">Prepared By</div>
        <div class="sig-box">Checked By</div>
        <div class="sig-box">Authorised By</div>
      </div>

      <div class="footer">
        Generated by Plant App &nbsp;·&nbsp; ${dateStr} ${timeStr}
      </div>

    </body>
    </html>
  `;

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const fileName = `dispatch-challan-${Date.now()}.pdf`;
    const destUri = FileSystem.cacheDirectory + fileName;
    await FileSystem.moveAsync({ from: uri, to: destUri });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert("Error", "Sharing is not available on this device");
      return;
    }

    await Sharing.shareAsync(destUri, {
      mimeType: "application/pdf",
      dialogTitle: "Share Dispatch Challan",
      UTI: "com.adobe.pdf",
    });
  } catch (e: any) {
    console.error("PDF error:", e);
    Alert.alert("PDF Error", e?.message ?? String(e));
  }
};

// ─── Item Picker Modal ────────────────────────────────────────────────────────

function ItemPickerModal({
  visible,
  items,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: MstItem[];
  onSelect: (item: MstItem) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? items.filter((i) => i.itmnm.toLowerCase().includes(search.toLowerCase()))
    : items;

  const grouped = filtered.reduce<Record<string, MstItem[]>>((acc, i) => {
    const k = i.itmsubcat ?? "Other";
    (acc[k] = acc[k] || []).push(i);
    return acc;
  }, {});

  const sections = Object.entries(grouped).map(([title, data]) => ({
    title,
    data,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={pickerStyles.backdrop}>
        <View style={pickerStyles.sheet}>
          <View style={pickerStyles.header}>
            <Text style={pickerStyles.title}>Select Item</Text>
            <TouchableOpacity style={pickerStyles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={pickerStyles.searchRow}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              style={pickerStyles.searchInput}
              placeholder="Search item..."
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <SectionList
            sections={sections}
            keyExtractor={(i) => i.itmcd}
            style={pickerStyles.list}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={pickerStyles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={pickerStyles.itemRow}
                onPress={() => {
                  onSelect(item);
                  onClose();
                  setSearch("");
                }}
              >
                <Text style={pickerStyles.itemName}>{item.itmnm}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={C.textMuted}
                />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={pickerStyles.empty}>No items found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Party / Depo Picker Modal ────────────────────────────────────────────────

function TargetPickerModal({
  visible,
  mode,
  parties,
  depos,
  onSelect,
  onClose,
}: {
  visible: boolean;
  mode: "PARTY" | "DEPO";
  parties: Party[];
  depos: Depo[];
  onSelect: (cd: string, nm: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered =
    mode === "PARTY"
      ? parties.filter((p) =>
          (p.lednm ?? "").toLowerCase().includes(search.toLowerCase()),
        )
      : depos.filter((d) =>
          d.untnm.toLowerCase().includes(search.toLowerCase()),
        );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={pickerStyles.backdrop}>
        <View style={pickerStyles.sheet}>
          <View style={pickerStyles.header}>
            <Text style={pickerStyles.title}>
              {mode === "PARTY" ? "Select Party" : "Select Depo"}
            </Text>
            <TouchableOpacity style={pickerStyles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={pickerStyles.searchRow}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              style={pickerStyles.searchInput}
              placeholder={`Search ${mode === "PARTY" ? "party" : "depo"}...`}
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(i) =>
              mode === "PARTY" ? (i as Party).ledcd : (i as Depo).untcd
            }
            style={pickerStyles.list}
            renderItem={({ item }) => {
              const isParty = mode === "PARTY";
              const cd = isParty ? (item as Party).ledcd : (item as Depo).untcd;
              const nm = isParty
                ? ((item as Party).lednm ?? cd)
                : (item as Depo).untnm;
              const sub = isParty
                ? (item as Party).areanm
                : (item as Depo).untshnm;
              return (
                <TouchableOpacity
                  style={pickerStyles.itemRow}
                  onPress={() => {
                    onSelect(cd, nm);
                    onClose();
                    setSearch("");
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={pickerStyles.itemName}>{nm}</Text>
                    {sub ? (
                      <Text style={pickerStyles.itemSub}>{sub}</Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={C.textMuted}
                  />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={pickerStyles.empty}>No results found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Session Card (used by both OFFICE's list and PPSUPERVISOR's queue) ──────

function SessionCard({
  session,
  onSelect,
  footerText,
}: {
  session: Session;
  onSelect: (s: Session) => void;
  footerText: string;
}) {
  const meta = STATUS_META[session.STATUS];
  return (
    <TouchableOpacity
      style={sesStyles.card}
      onPress={() => onSelect(session)}
      activeOpacity={0.75}
    >
      <View style={sesStyles.cardTop}>
        <View style={sesStyles.badgeRow}>
          <View
            style={[
              sesStyles.typeBadge,
              session.DISPATCH_TO === "DEPO"
                ? sesStyles.typeBadgeDepo
                : sesStyles.typeBadgeParty,
            ]}
          >
            <Text
              style={[
                sesStyles.typeBadgeText,
                session.DISPATCH_TO === "DEPO"
                  ? sesStyles.typeBadgeTextDepo
                  : sesStyles.typeBadgeTextParty,
              ]}
            >
              {session.DISPATCH_TO === "DEPO" ? "Own Depo" : "Direct to Party"}
            </Text>
          </View>
          <View
            style={[
              sesStyles.statusBadge,
              { backgroundColor: meta.bg, borderColor: meta.border },
            ]}
          >
            <Text style={[sesStyles.statusBadgeText, { color: meta.text }]}>
              {meta.label}
            </Text>
          </View>
        </View>
        <Text style={sesStyles.time}>
          {new Date(session.CREATEDAT ?? Date.now()).toLocaleTimeString(
            "en-IN",
            { hour: "2-digit", minute: "2-digit" },
          )}
        </Text>
      </View>
      <Text style={sesStyles.partyName}>{session.PARTY_NM}</Text>
      <Text style={sesStyles.itemCount}>
        {session.items.length} item{session.items.length !== 1 ? "s" : ""}
        {session.emptyItems.length > 0
          ? `  ·  ${session.emptyItems.length} empty`
          : ""}
        {session.VEHICLE_NO ? `  ·  ${session.VEHICLE_NO}` : ""}
      </Text>
      <View style={sesStyles.cardFooter}>
        <Text style={sesStyles.fillHint}>{footerText}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Loading Entries Table (per dispatch item, supervisor-only) ──────────────

function LoadingEntriesTable({
  entries,
  wgtconv,
  avgWtPerBox,
  editable,
  onAddEntry,
  onUpdateEntry,
  onRemoveEntry,
}: {
  entries: LoadingEntryRow[];
  wgtconv: string;
  avgWtPerBox: string;
  editable: boolean;
  onAddEntry: () => void;
  onUpdateEntry: (idx: number, field: keyof LoadingEntryRow, value: string) => void;
  onRemoveEntry: (idx: number) => void;
}) {
  const totalBoxes = computeItemTotalBoxes(entries);
  const weight = computeItemWeight(entries, wgtconv);
  const grossWeight = computeItemGrossWeight(entries, avgWtPerBox);

  return (
    <View style={loadStyles.wrap}>
      <View style={loadStyles.headerRow}>
        <Text style={[loadStyles.headCell, loadStyles.colDim]}>L</Text>
        <Text style={[loadStyles.headCell, loadStyles.colDim]}>W</Text>
        <Text style={[loadStyles.headCell, loadStyles.colDim]}>H</Text>
        <Text style={[loadStyles.headCell, loadStyles.colDim]}>Extra</Text>
        <Text style={[loadStyles.headCell, loadStyles.colSub]}>Boxes</Text>
        {editable && <View style={loadStyles.colAction} />}
      </View>

      {entries.length === 0 ? (
        <Text style={loadStyles.emptyText}>No loading entries yet</Text>
      ) : (
        entries.map((entry, idx) => {
          const subtotal = computeEntrySubtotal(entry);
          return (
            <View key={entry.key} style={loadStyles.row}>
              <View style={loadStyles.colDim}>
                <TextInput
                  style={[loadStyles.dimInput, entry.length ? loadStyles.dimInputFilled : null]}
                  value={entry.length}
                  onChangeText={(v) => onUpdateEntry(idx, "length", v)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  editable={editable}
                />
              </View>
              <View style={loadStyles.colDim}>
                <TextInput
                  style={[loadStyles.dimInput, entry.width ? loadStyles.dimInputFilled : null]}
                  value={entry.width}
                  onChangeText={(v) => onUpdateEntry(idx, "width", v)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  editable={editable}
                />
              </View>
              <View style={loadStyles.colDim}>
                <TextInput
                  style={[loadStyles.dimInput, entry.height ? loadStyles.dimInputFilled : null]}
                  value={entry.height}
                  onChangeText={(v) => onUpdateEntry(idx, "height", v)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  editable={editable}
                />
              </View>
              <View style={loadStyles.colDim}>
                <TextInput
                  style={[loadStyles.dimInput, entry.extra ? loadStyles.dimInputFilled : null]}
                  value={entry.extra}
                  onChangeText={(v) => onUpdateEntry(idx, "extra", v)}
                  keyboardType="numbers-and-punctuation"
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  editable={editable}
                />
              </View>
              <View style={loadStyles.colSub}>
                <Text style={loadStyles.subtotalText}>{fmtNum(subtotal)}</Text>
              </View>
              {editable && (
                <View style={loadStyles.colAction}>
                  <TouchableOpacity
                    onPress={() => onRemoveEntry(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="remove-circle-outline" size={18} color={C.red} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })
      )}

      {editable && (
        <TouchableOpacity style={loadStyles.addEntryBtn} onPress={onAddEntry}>
          <Ionicons name="add" size={14} color={C.primary} />
          <Text style={loadStyles.addEntryBtnText}>Add Entry</Text>
        </TouchableOpacity>
      )}

      {entries.length > 1 && (
        <View style={loadStyles.totalsRow}>
          <Text style={loadStyles.totalsLabel}>Item Total</Text>
          <Text style={loadStyles.totalsValue}>
            {fmtNum(totalBoxes)} boxes
          </Text>
        </View>
      )}

      {entries.length > 0 && (
        <View style={loadStyles.weightRow}>
          <Text style={loadStyles.weightLabel}>Weight</Text>
          <Text style={loadStyles.weightValue}>{fmtNum(weight)} kg</Text>
        </View>
      )}

      {entries.length > 0 && (
        <View style={loadStyles.grossWeightRow}>
          <Text style={loadStyles.grossWeightLabel}>Gross Weight</Text>
          <Text style={loadStyles.grossWeightValue}>
            {fmtNum(grossWeight)} kg
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DispatchPlantScreen() {
  const router = useRouter();

  const [empType, setEmpType] = useState<EmpType>("OFFICE");
  const [empId, setEmpId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Master data
  const [allItems, setAllItems] = useState<MstItem[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [depos, setDepos] = useState<Depo[]>([]);

  // OFFICE — own sessions (all statuses) + current screen mode.
  //   "list"     — the session list.
  //   "details"  — Dispatch Details + Empty Material Details, the only page
  //                 office fills before sending. Editable while DRAFT or
  //                 PENDING.
  //   "finalize" — read-only recap of the supervisor's loading work, plus
  //                 the Transporter/Weight Details form. Only reachable for
  //                 COMPLETED (editable) or FINALIZED (read-only) sessions.
  const [officeSessions, setOfficeSessions] = useState<Session[]>([]);
  const [officeMode, setOfficeMode] = useState<"list" | "details" | "finalize">(
    "list",
  );

  // PPSUPERVISOR — pending queue
  const [sessions, setSessions] = useState<Session[]>([]);

  // Shared: the session currently open for both roles. null = OFFICE is
  // creating a brand new session.
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // Form state — Dispatch Details + Empty Material (office's "details" page)
  const [dispatchTo, setDispatchTo] = useState<"DEPO" | "PARTY">("DEPO");
  const [partyCd, setPartyCd] = useState("");
  const [partyNm, setPartyNm] = useState("");
  const [dispItems, setDispItems] = useState<DispatchItemRow[]>([blankRow()]);
  const [emptyItems, setEmptyItems] = useState<EmptyItemRow[]>([blankEmpty()]);

  // Form state — Transporter Details (office's "finalize" page)
  const [vehicleNo, setVehicleNo] = useState("");
  const [biltyNo, setBiltyNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverNo, setDriverNo] = useState("");
  const [grrNo, setGrrNo] = useState("");
  const [transporter, setTransporter] = useState("");

  // Form state — Weight Details (also office's "finalize" page)
  const [grossWt, setGrossWt] = useState("");
  const [tareWt, setTareWt] = useState("");
  const [totalWt, setTotalWt] = useState("");
  const [totalFreight, setTotalFreight] = useState("");
  const [advance, setAdvance] = useState("");

  // Picker modals
  const [targetPickerVisible, setTargetPickerVisible] = useState(false);
  const [itemPickerVisible, setItemPickerVisible] = useState(false);
  const [itemPickerTarget, setItemPickerTarget] = useState<{
    table: "dispatch" | "empty";
    idx: number;
  } | null>(null);

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // True once OFFICE has already finalized (Transporter + Weight filled,
  // locked for everyone). Used only within "finalize" mode to decide
  // whether that form is editable or a read-only recap.
  const finalizeReadOnly = activeSession?.STATUS === "FINALIZED";

  // True for a PENDING session being edited by OFFICE in "details" mode —
  // it's already been sent once, so the footer action must be "save", not
  // "send" again (the backend rejects a re-send of a non-DRAFT session).
  const detailsAlreadySent = activeSession?.STATUS === "PENDING";

  // Live preview of Balance while OFFICE is typing in "finalize" mode — the
  // authoritative value always comes back from the server on save, this is
  // just for feedback.
  const liveBalance = (Number(totalFreight) || 0) - (Number(advance) || 0);

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      if (!raw) {
        router.back();
        return;
      }
      const emp = JSON.parse(raw);

      if (emp.EMPTYPE !== "OFFICE" && emp.EMPTYPE !== "PPSUPERVISOR") {
        Alert.alert(
          "Access Denied",
          "This screen is for OFFICE and PP Supervisor users only.",
        );
        router.back();
        return;
      }

      setEmpType(emp.EMPTYPE as EmpType);
      setEmpId(emp.EMP_ID);

      if (emp.EMPTYPE === "OFFICE") {
        const [itemsRes, partiesRes, deposRes] = await Promise.all([
          fetch(`${API_URL}/dispatch/items`),
          fetch(`${API_URL}/dispatch/parties`),
          fetch(`${API_URL}/dispatch/depos`),
        ]);
        const [itemsData, partiesData, deposData] = await Promise.all([
          itemsRes.json(),
          partiesRes.json(),
          deposRes.json(),
        ]);
        if (itemsData.success) setAllItems(itemsData.data);
        if (partiesData.success) setParties(partiesData.data);
        if (deposData.success) setDepos(deposData.data);
        await loadOfficeSessions(emp.EMP_ID);
      } else {
        // PPSUPERVISOR still needs item master data (for wgtconv, since the
        // weight calc needs weight-per-box even though item selection itself
        // is locked for this role).
        const [itemsRes] = await Promise.all([
          fetch(`${API_URL}/dispatch/items`),
        ]);
        const itemsData = await itemsRes.json();
        if (itemsData.success) setAllItems(itemsData.data);
        await loadPendingSessions();
      }
    } catch {
      Alert.alert("Error", "Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  const loadOfficeSessions = async (empIdOverride?: string) => {
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/today?doneBy=${empIdOverride ?? empId}`,
      );
      const data = await res.json();
      if (data.success) setOfficeSessions(data.data);
    } catch {
      Alert.alert("Error", "Failed to load sessions.");
    }
  };

  const loadPendingSessions = async () => {
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/today?status=PENDING`,
      );
      const data = await res.json();
      if (data.success) setSessions(data.data);
    } catch {
      Alert.alert("Error", "Failed to load sessions.");
    }
  };

  // Look up weight-per-box for an item code from the loaded master list.
  const wgtconvFor = useCallback(
    (itmcd: string): string => {
      const found = allItems.find((i) => i.itmcd === itmcd);
      return found?.wgtconv ?? "";
    },
    [allItems],
  );

  // ── Item row helpers ──────────────────────────────────────────────────────

  const openItemPicker = (table: "dispatch" | "empty", idx: number) => {
    setItemPickerTarget({ table, idx });
    setItemPickerVisible(true);
  };

  const onItemSelected = (item: MstItem) => {
    if (!itemPickerTarget) return;
    const { table, idx } = itemPickerTarget;
    if (table === "dispatch") {
      setDispItems((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                itmcd: item.itmcd,
                itmnm: item.itmnm,
                wgtconv: item.wgtconv ?? "",
              }
            : r,
        ),
      );
    } else {
      setEmptyItems((prev) =>
        prev.map((r, i) =>
          i === idx ? { ...r, itmcd: item.itmcd, itmnm: item.itmnm } : r,
        ),
      );
    }
    setItemPickerTarget(null);
  };

  const updateDispRow = useCallback(
    (idx: number, field: "qty", value: string) => {
      setDispItems((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const updateAvgWtPerBox = useCallback((idx: number, value: string) => {
    setDispItems((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, avgWtPerBox: value } : r)),
    );
  }, []);

  const updateEmptyRow = useCallback(
    (idx: number, field: keyof EmptyItemRow, value: string) => {
      setEmptyItems((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const removeDispRow = (idx: number) =>
    setDispItems((prev) => prev.filter((_, i) => i !== idx));
  const removeEmptyRow = (idx: number) =>
    setEmptyItems((prev) => prev.filter((_, i) => i !== idx));

  // ── Loading entry helpers (supervisor's per-item table) ──────────────────

  const addLoadingEntry = (itemIdx: number) => {
    setDispItems((prev) =>
      prev.map((r, i) =>
        i === itemIdx
          ? { ...r, loadingEntries: [...r.loadingEntries, blankLoadingEntry()] }
          : r,
      ),
    );
  };

  const updateLoadingEntry = (
    itemIdx: number,
    entryIdx: number,
    field: keyof LoadingEntryRow,
    value: string,
  ) => {
    setDispItems((prev) =>
      prev.map((r, i) =>
        i === itemIdx
          ? {
              ...r,
              loadingEntries: r.loadingEntries.map((e, j) =>
                j === entryIdx ? { ...e, [field]: value } : e,
              ),
            }
          : r,
      ),
    );
  };

  const removeLoadingEntry = (itemIdx: number, entryIdx: number) => {
    setDispItems((prev) =>
      prev.map((r, i) =>
        i === itemIdx
          ? {
              ...r,
              loadingEntries: r.loadingEntries.filter((_, j) => j !== entryIdx),
            }
          : r,
      ),
    );
  };

  const resetForm = () => {
    setDispatchTo("DEPO");
    setPartyCd("");
    setPartyNm("");
    setDispItems([blankRow()]);
    setEmptyItems([blankEmpty()]);
    setVehicleNo("");
    setBiltyNo("");
    setDriverName("");
    setDriverNo("");
    setGrrNo("");
    setTransporter("");
    setGrossWt("");
    setTareWt("");
    setTotalWt("");
    setTotalFreight("");
    setAdvance("");
  };

  // ── Hydrate local form state from a fetched session (used by both roles) ──

  const hydrateItemRows = useCallback(
    (session: Session): DispatchItemRow[] =>
      session.items.map((i) => ({
        key: i.ITEM_ID,
        itemId: i.ITEM_ID,
        itmcd: i.ITMCD,
        itmnm: i.ITMNM,
        qty: String(i.QTY),
        wgtconv: wgtconvFor(i.ITMCD),
        avgWtPerBox: i.AVG_WT_PER_BOX != null ? String(i.AVG_WT_PER_BOX) : "",
        loadingEntries: (i.loadingEntries ?? []).map((e) => ({
          key: e.ENTRY_ID,
          entryId: e.ENTRY_ID,
          length: String(e.LENGTH),
          width: String(e.WIDTH),
          height: String(e.HEIGHT),
          extra: String(e.EXTRA),
        })),
      })),
    [wgtconvFor],
  );

  const hydrateEmptyRows = (session: Session): EmptyItemRow[] =>
    session.emptyItems.map((i) => ({
      key: i.ITEM_ID,
      itemId: i.ITEM_ID,
      itmcd: i.ITMCD,
      itmnm: i.ITMNM,
      qty: String(i.QTY),
    }));

  const hydrateSessionIntoForm = useCallback(
    (session: Session) => {
      setDispatchTo(session.DISPATCH_TO as "DEPO" | "PARTY");
      setPartyCd(session.PARTY_CD);
      setPartyNm(session.PARTY_NM);
      setVehicleNo(session.VEHICLE_NO ?? "");
      setBiltyNo(session.BILTY_NO ?? "");
      setDriverName(session.DRIVER_NAME ?? "");
      setDriverNo(session.DRIVER_NO ?? "");
      setGrrNo(session.GRR_NO ?? "");
      setTransporter(session.TRANSPORTER ?? "");
      setGrossWt(session.GROSS_WT ?? "");
      setTareWt(session.TARE_WT ?? "");
      setTotalWt(session.TOTAL_WT ?? "");
      setTotalFreight(session.TOTAL_FREIGHT ?? "");
      setAdvance(session.ADVANCE ?? "");
      setDispItems(hydrateItemRows(session));
      setEmptyItems(hydrateEmptyRows(session));
    },
    [hydrateItemRows],
  );

  // ── OFFICE: payload builders ───────────────────────────────────────────────
  // Split in two because the two office pages write disjoint fields at
  // disjoint stages: "details" writes Dispatch/Empty Material (create or
  // update, pre-send or PENDING), "finalize" writes Transporter/Weight
  // (only once, post-supervisor). Sending the wrong shape to the wrong
  // endpoint would either silently no-op fields the endpoint no longer
  // accepts or, worse, mask a stage the UI shouldn't be able to reach.

  const buildDetailsPayload = () => {
    const validDisp = dispItems.filter((r) => r.itmcd && r.qty.trim());
    // Empty Material has no "at least one" requirement — a session can be
    // sent with zero empty-material rows.
    const validEmpty = emptyItems.filter((r) => r.itmcd && r.qty.trim());
    return {
      doneBy: empId,
      dispatchTo,
      partyCd,
      partyNm,
      items: validDisp.map((r) => ({ itmcd: r.itmcd, itmnm: r.itmnm, qty: r.qty })),
      emptyItems: validEmpty.map((r) => ({
        itmcd: r.itmcd,
        itmnm: r.itmnm,
        qty: r.qty,
      })),
    };
  };

  const buildFinalizePayload = () => ({
    doneBy: empId,
    vehicleNo,
    biltyNo,
    transporter,
    driverName,
    driverNo,
    grrNo,
    grossWt,
    tareWt,
    totalWt,
    totalFreight,
    advance,
  });

  // ── OFFICE: mode navigation ────────────────────────────────────────────────

  const startNewSession = () => {
    setActiveSession(null);
    resetForm();
    setOfficeMode("details");
  };

  const openOfficeSession = (session: Session) => {
    setActiveSession(session);
    hydrateSessionIntoForm(session);
    // DRAFT/PENDING still owe Dispatch/Empty Material Details ("details");
    // COMPLETED/FINALIZED have that frozen and instead show the supervisor's
    // work alongside Transporter/Weight Details ("finalize").
    setOfficeMode(
      session.STATUS === "COMPLETED" || session.STATUS === "FINALIZED"
        ? "finalize"
        : "details",
    );
  };

  const exitToList = () => {
    setActiveSession(null);
    resetForm();
    setOfficeMode("list");
    loadOfficeSessions();
  };

  // Best-effort silent save when backing out of "details" mode without
  // explicitly sending/saving — mirrors the old wizard's back-arrow
  // behavior. Only applies to an existing DRAFT/PENDING session; a brand
  // new, never-saved session is simply discarded on back-out, same as
  // before.
  const handleDetailsBackArrow = async () => {
    if (
      activeSession &&
      (activeSession.STATUS === "DRAFT" || activeSession.STATUS === "PENDING")
    ) {
      setSubmitting(true);
      try {
        await fetch(`${API_URL}/dispatch/sessions/${activeSession.SESSION_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDetailsPayload()),
        });
      } catch {
        // best-effort background save — don't block leaving on a failure
      } finally {
        setSubmitting(false);
      }
    }
    exitToList();
  };

  // ── OFFICE: "details" page actions ────────────────────────────────────────

  // DRAFT (new or existing): create-or-update, then send in one tap.
  const handleSendToSupervisor = async () => {
    if (!partyCd) {
      Alert.alert(
        "Missing",
        `Please select a ${dispatchTo === "DEPO" ? "depo" : "party"}.`,
      );
      return;
    }
    const validDisp = dispItems.filter((r) => r.itmcd && r.qty.trim());
    if (validDisp.length === 0) {
      Alert.alert("Missing", "Add at least one dispatch item with a quantity.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildDetailsPayload();
      const saveRes = activeSession
        ? await fetch(`${API_URL}/dispatch/sessions/${activeSession.SESSION_ID}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`${API_URL}/dispatch/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        Alert.alert("Error", saveData.message || "Failed to save");
        return;
      }

      const sessionId = saveData.data.SESSION_ID;
      const sendRes = await fetch(
        `${API_URL}/dispatch/sessions/${sessionId}/send`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doneBy: empId }),
        },
      );
      const sendData = await sendRes.json();
      if (sendRes.ok && sendData.success) {
        Alert.alert("Sent", "Dispatch session sent to the supervisor.");
        exitToList();
      } else {
        Alert.alert("Error", sendData.message || "Failed to send");
      }
    } catch (err: any) {
      console.log(err);
      Alert.alert("Error", "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // PENDING: office edits an already-sent session — save only, never
  // re-send (the backend rejects re-sending a non-DRAFT session).
  const handleSaveDetails = async () => {
    if (!activeSession) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/${activeSession.SESSION_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDetailsPayload()),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert("Saved", "Your changes have been saved.");
        exitToList();
      } else {
        Alert.alert("Error", data.message || "Failed to save");
      }
    } catch (err: any) {
      console.log(err);
      Alert.alert("Error", "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── OFFICE: "finalize" page actions ───────────────────────────────────────

  // COMPLETED: office fills Transporter/Weight for the first time and
  // finalizes. This is the first point in the flow where every section of
  // the challan (items, supervisor's loading entries, transporter, weight/
  // freight) actually has data, so the PDF is generated and shared here —
  // not at send-time or at supervisor-complete-time, when it would have
  // been mostly blank.
  const handleFinalize = async () => {
    if (!activeSession) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/${activeSession.SESSION_ID}/finalize`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildFinalizePayload()),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        const finalized: Session = data.data;
        await generateAndSharePDF({
          dispatchTo,
          partyNm,
          createdAt: fmtDateTime(finalized.CREATEDAT ?? activeSession.CREATEDAT),
          vehicleNo,
          biltyNo,
          transporter,
          driverName,
          driverNo,
          grrNo,
          grossWt,
          tareWt,
          totalWt,
          totalFreight,
          advance,
          balance:
            finalized.BALANCE != null
              ? String(finalized.BALANCE)
              : fmtNum(liveBalance),
          items: dispItems
            .filter((r) => r.itmnm)
            .map((r) => ({
              itmnm: r.itmnm,
              qty: r.qty,
              totalBoxes: computeItemTotalBoxes(r.loadingEntries),
              weight: computeItemWeight(r.loadingEntries, r.wgtconv),
              grossWeight: computeItemGrossWeight(r.loadingEntries, r.avgWtPerBox),
              entries: r.loadingEntries,
            })),
          emptyItems: emptyItems.filter((r) => r.itmcd),
        });
        Alert.alert("Finalized", "Dispatch session finalized.");
        exitToList();
      } else {
        Alert.alert("Error", data.message || "Failed to finalize");
      }
    } catch (err: any) {
      console.log("errori is", err);
      Alert.alert("Error", "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // FINALIZED: already saved server-side, this just re-shares the same
  // challan without another API call.
  const handleShareChallan = async () => {
    if (!activeSession) return;
    await generateAndSharePDF({
      dispatchTo,
      partyNm,
      createdAt: fmtDateTime(activeSession.CREATEDAT),
      vehicleNo,
      biltyNo,
      transporter,
      driverName,
      driverNo,
      grrNo,
      grossWt,
      tareWt,
      totalWt,
      totalFreight,
      advance,
      balance:
        activeSession.BALANCE != null
          ? String(activeSession.BALANCE)
          : fmtNum(liveBalance),
      items: dispItems
        .filter((r) => r.itmnm)
        .map((r) => ({
          itmnm: r.itmnm,
          qty: r.qty,
          totalBoxes: computeItemTotalBoxes(r.loadingEntries),
          weight: computeItemWeight(r.loadingEntries, r.wgtconv),
          grossWeight: computeItemGrossWeight(r.loadingEntries, r.avgWtPerBox),
          entries: r.loadingEntries,
        })),
      emptyItems: emptyItems.filter((r) => r.itmcd),
    });
  };

  // ── PPSUPERVISOR: open + complete a session ───────────────────────────────

  const openSession = (session: Session) => {
    setActiveSession(session);
    hydrateSessionIntoForm(session);
  };

  const handlePPSubmit = async () => {
    if (!activeSession) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/${activeSession.SESSION_ID}/complete`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doneBy: empId,
            items: dispItems.map((r) => ({
              itemId: r.itemId,
              qty: r.qty,
              avgWtPerBox: r.avgWtPerBox,
              loadingEntries: r.loadingEntries
                .filter(
                  (e) => e.length || e.width || e.height || e.extra,
                )
                .map((e) => ({
                  length: e.length || "0",
                  width: e.width || "0",
                  height: e.height || "0",
                  extra: e.extra || "0",
                })),
            })),
          }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert(
          "Completed",
          "Loading details recorded. This session now goes back to office to finalize.",
        );
        setActiveSession(null);
        resetForm();
        await loadPendingSessions();
      } else {
        Alert.alert("Error", data.message || "Failed");
      }
    } catch(err: any) {
      console.log(err);
      Alert.alert("Error", "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── OFFICE: session list ───────────────────────────────────────────────
  if (empType === "OFFICE" && officeMode === "list") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarTitle}>Dispatch Plant</Text>
            <Text style={styles.topBarSub}>{dateLabel}</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => loadOfficeSessions()}
          >
            <Ionicons name="refresh-outline" size={20} color={C.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.progressBarTrack} />

        <View style={styles.newSessionBar}>
          <TouchableOpacity style={styles.newSessionBtn} onPress={startNewSession}>
            <Ionicons name="add-circle" size={18} color={C.textInverse} />
            <Text style={styles.newSessionBtnText}>New Dispatch Session</Text>
          </TouchableOpacity>
        </View>

        {officeSessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyStateText}>No dispatch sessions yet</Text>
            <Text style={styles.emptyStateSub}>
              Create a new session to get started
            </Text>
          </View>
        ) : (
          <FlatList
            data={officeSessions}
            keyExtractor={(s) => s.SESSION_ID}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                Your Sessions ({officeSessions.length})
              </Text>
            }
            renderItem={({ item }) => (
              <SessionCard
                session={item}
                onSelect={openOfficeSession}
                footerText={OFFICE_FOOTER_TEXT[item.STATUS]}
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── OFFICE: "details" mode — Dispatch Details + Empty Material Details,
  //    the only page office fills before sending. Always editable: this
  //    mode is only ever entered for a DRAFT or PENDING session (see
  //    openOfficeSession / startNewSession). ─────────────────────────────
  if (empType === "OFFICE" && officeMode === "details") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={handleDetailsBackArrow}
            >
              <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.topBarTitle}>
                {activeSession ? activeSession.PARTY_NM || "Dispatch Session" : "New Dispatch"}
              </Text>
              <Text style={styles.topBarSub}>{dateLabel}</Text>
            </View>
            {activeSession && (
              <View
                style={[
                  styles.wizardStatusBadge,
                  {
                    backgroundColor: STATUS_META[activeSession.STATUS].bg,
                    borderColor: STATUS_META[activeSession.STATUS].border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.wizardStatusBadgeText,
                    { color: STATUS_META[activeSession.STATUS].text },
                  ]}
                >
                  {STATUS_META[activeSession.STATUS].label}
                </Text>
              </View>
            )}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionBadgeText}>A</Text>
              </View>
              <Text style={styles.sectionTitle}>Dispatch Details</Text>
            </View>

            {/* Dispatch To toggle */}
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Dispatch To</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    dispatchTo === "DEPO" && styles.toggleBtnActive,
                  ]}
                  onPress={() => {
                    setDispatchTo("DEPO");
                    setPartyCd("");
                    setPartyNm("");
                  }}
                >
                  <Ionicons
                    name="business-outline"
                    size={16}
                    color={dispatchTo === "DEPO" ? C.primary : C.textMuted}
                  />
                  <Text
                    style={[
                      styles.toggleBtnText,
                      dispatchTo === "DEPO" && styles.toggleBtnTextActive,
                    ]}
                  >
                    Own Depo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    dispatchTo === "PARTY" && styles.toggleBtnActive,
                  ]}
                  onPress={() => {
                    setDispatchTo("PARTY");
                    setPartyCd("");
                    setPartyNm("");
                  }}
                >
                  <Ionicons
                    name="people-outline"
                    size={16}
                    color={dispatchTo === "PARTY" ? C.primary : C.textMuted}
                  />
                  <Text
                    style={[
                      styles.toggleBtnText,
                      dispatchTo === "PARTY" && styles.toggleBtnTextActive,
                    ]}
                  >
                    Direct to Party
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                {dispatchTo === "DEPO" ? "Depo Name" : "Party Name"}
              </Text>
              <TouchableOpacity
                style={[
                  styles.selectorBtn,
                  partyCd ? styles.selectorBtnFilled : null,
                ]}
                onPress={() => setTargetPickerVisible(true)}
              >
                <Text
                  style={
                    partyCd
                      ? styles.selectorBtnFilledText
                      : styles.selectorBtnPlaceholder
                  }
                  numberOfLines={1}
                >
                  {partyNm ||
                    `Select ${dispatchTo === "DEPO" ? "depo" : "party"}…`}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={partyCd ? C.primary : C.textMuted}
                />
              </TouchableOpacity>

              {activeSession && (
                <View style={styles.createdRow}>
                  <Ionicons name="time-outline" size={13} color={C.textMuted} />
                  <Text style={styles.createdText}>
                    Created {fmtDateTime(activeSession.CREATEDAT)}
                  </Text>
                </View>
              )}
            </View>

            {/* Items */}
            <View style={styles.card}>
              <View style={styles.tableTitleRow}>
                <Text style={styles.tableTitle}>Item Details</Text>
                <TouchableOpacity
                  style={styles.addRowBtn}
                  onPress={() => setDispItems((p) => [...p, blankRow()])}
                >
                  <Ionicons name="add" size={16} color={C.primary} />
                  <Text style={styles.addRowBtnText}>Add Row</Text>
                </TouchableOpacity>
              </View>

              {dispItems.map((row, idx) => (
                <View
                  key={row.key}
                  style={[
                    styles.itemBlock,
                    idx < dispItems.length - 1 && styles.itemBlockBorder,
                  ]}
                >
                  <View style={styles.itemBlockHeader}>
                    <View style={{ flex: 1 }}>
                      <TouchableOpacity
                        style={[
                          styles.itemSelector,
                          row.itmcd ? styles.itemSelectorFilled : null,
                        ]}
                        onPress={() => openItemPicker("dispatch", idx)}
                      >
                        <Text
                          style={
                            row.itmcd
                              ? styles.itemSelectorFilledText
                              : styles.itemSelectorPlaceholder
                          }
                          numberOfLines={2}
                        >
                          {row.itmnm || "Select item…"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.qtyInputWrap}>
                      <TextInput
                        style={[
                          styles.numInput,
                          row.qty ? styles.numInputFilled : null,
                        ]}
                        value={row.qty}
                        onChangeText={(v) => updateDispRow(idx, "qty", v)}
                        keyboardType="decimal-pad"
                        placeholder="Qty"
                        placeholderTextColor={C.textMuted}
                      />
                    </View>

                    {dispItems.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeDispRow(idx)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ marginLeft: 8 }}
                      >
                        <Ionicons
                          name="remove-circle-outline"
                          size={20}
                          color={C.red}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Section B */}
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionBadge, styles.sectionBadgeB]}>
                <Text style={styles.sectionBadgeText}>B</Text>
              </View>
              <Text style={styles.sectionTitle}>Empty Material Details</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.tableTitleRow}>
                <Text style={styles.tableTitle}>Items</Text>
                <TouchableOpacity
                  style={styles.addRowBtn}
                  onPress={() => setEmptyItems((p) => [...p, blankEmpty()])}
                >
                  <Ionicons name="add" size={16} color={C.primary} />
                  <Text style={styles.addRowBtnText}>Add Row</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.colItemWide]}>
                  Item Name
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
                <View style={styles.colAction} />
              </View>

              {emptyItems.map((row, idx) => (
                <View
                  key={row.key}
                  style={[
                    styles.tableRow,
                    idx < emptyItems.length - 1 && styles.tableRowBorder,
                  ]}
                >
                  <View style={styles.colItemWide}>
                    <TouchableOpacity
                      style={[
                        styles.itemSelector,
                        row.itmcd ? styles.itemSelectorFilled : null,
                      ]}
                      onPress={() => openItemPicker("empty", idx)}
                    >
                      <Text
                        style={
                          row.itmcd
                            ? styles.itemSelectorFilledText
                            : styles.itemSelectorPlaceholder
                        }
                        numberOfLines={2}
                      >
                        {row.itmnm || "Select item…"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.colQty}>
                    <TextInput
                      style={[
                        styles.numInput,
                        row.qty ? styles.numInputFilled : null,
                      ]}
                      value={row.qty}
                      onChangeText={(v) => updateEmptyRow(idx, "qty", v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={C.textMuted}
                    />
                  </View>
                  <View style={styles.colAction}>
                    {emptyItems.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeEmptyRow(idx)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="remove-circle-outline"
                          size={20}
                          color={C.red}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={detailsAlreadySent ? handleSaveDetails : handleSendToSupervisor}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={C.textInverse} size="small" />
              ) : (
                <>
                  <Ionicons
                    name={detailsAlreadySent ? "save-outline" : "send-outline"}
                    size={18}
                    color={C.textInverse}
                  />
                  <Text style={styles.submitBtnText}>
                    {detailsAlreadySent ? "Save Changes" : "Send to Supervisor"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        <TargetPickerModal
          visible={targetPickerVisible}
          mode={dispatchTo}
          parties={parties}
          depos={depos}
          onSelect={(cd, nm) => {
            setPartyCd(cd);
            setPartyNm(nm);
          }}
          onClose={() => setTargetPickerVisible(false)}
        />
        <ItemPickerModal
          visible={itemPickerVisible}
          items={allItems}
          onSelect={onItemSelected}
          onClose={() => setItemPickerVisible(false)}
        />
      </SafeAreaView>
    );
  }

  // ── OFFICE: "finalize" mode — read-only recap of the supervisor's work,
  //    plus Transporter/Weight Details, filled here for the first time.
  //    Editable while COMPLETED; read-only once FINALIZED. Only ever
  //    entered for a COMPLETED or FINALIZED session (see
  //    openOfficeSession). ──────────────────────────────────────────────
  if (empType === "OFFICE" && officeMode === "finalize") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.backBtn} onPress={exitToList}>
              <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.topBarTitle}>
                {activeSession?.PARTY_NM || "Dispatch Session"}
              </Text>
              <Text style={styles.topBarSub}>
                {activeSession ? STATUS_META[activeSession.STATUS].label : dateLabel}
              </Text>
            </View>
            {activeSession && (
              <View
                style={[
                  styles.wizardStatusBadge,
                  {
                    backgroundColor: STATUS_META[activeSession.STATUS].bg,
                    borderColor: STATUS_META[activeSession.STATUS].border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.wizardStatusBadgeText,
                    { color: STATUS_META[activeSession.STATUS].text },
                  ]}
                >
                  {STATUS_META[activeSession.STATUS].label}
                </Text>
              </View>
            )}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Recap: Dispatch Details (read-only, frozen) ── */}
            <View style={styles.sectionHeader}>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionBadgeText}>A</Text>
              </View>
              <Text style={styles.sectionTitle}>Dispatch Details</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>
                {dispatchTo === "DEPO" ? "Depo Name" : "Party Name"}
              </Text>
              <View
                style={[styles.selectorBtn, styles.selectorBtnFilled, { opacity: 0.7 }]}
              >
                <Text style={styles.selectorBtnFilledText} numberOfLines={1}>
                  {partyNm}
                </Text>
              </View>
              {activeSession && (
                <View style={styles.createdRow}>
                  <Ionicons name="time-outline" size={13} color={C.textMuted} />
                  <Text style={styles.createdText}>
                    Created {fmtDateTime(activeSession.CREATEDAT)}
                  </Text>
                </View>
              )}
            </View>

            {/* ── Recap: items + the supervisor's loading entries ── */}
            <View style={styles.card}>
              <Text style={styles.tableTitle}>Item Details</Text>
              {dispItems.map((row, idx) => (
                <View
                  key={row.key}
                  style={[
                    styles.itemBlock,
                    idx < dispItems.length - 1 && styles.itemBlockBorder,
                  ]}
                >
                  <View style={styles.itemBlockHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemNameReadOnly}>
                        {row.itmnm}
                        {row.qty ? (
                          <Text style={styles.itemQtyBracket}> ({row.qty})</Text>
                        ) : null}
                      </Text>
                    </View>
                    {row.avgWtPerBox ? (
                      <View style={styles.avgWtInputWrap}>
                        <Text style={styles.avgWtLabel}>Avg Wt/Box</Text>
                        <Text style={styles.itemNameReadOnly}>
                          {row.avgWtPerBox}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {(row.avgWtPerBox || row.loadingEntries.length > 0) && (
                    <LoadingEntriesTable
                      entries={row.loadingEntries}
                      wgtconv={row.wgtconv}
                      avgWtPerBox={row.avgWtPerBox}
                      editable={false}
                      onAddEntry={() => {}}
                      onUpdateEntry={() => {}}
                      onRemoveEntry={() => {}}
                    />
                  )}
                </View>
              ))}
            </View>

            {/* ── Recap: empty material ── */}
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionBadge, styles.sectionBadgeB]}>
                <Text style={styles.sectionBadgeText}>B</Text>
              </View>
              <Text style={styles.sectionTitle}>Empty Material Details</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.colItemWide]}>
                  Item Name
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
              </View>
              {emptyItems.map((row, idx) => (
                <View
                  key={row.key}
                  style={[
                    styles.tableRow,
                    idx < emptyItems.length - 1 && styles.tableRowBorder,
                  ]}
                >
                  <View style={styles.colItemWide}>
                    <Text style={styles.itemNameReadOnly}>{row.itmnm}</Text>
                  </View>
                  <View style={styles.colQty}>
                    <Text style={styles.itemNameReadOnly}>{row.qty || "—"}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* ── Transporter Details — filled here, for the first time ── */}
            <View style={styles.card}>
              <Text style={styles.tableTitle}>Transporter Details</Text>
              <View style={[styles.fieldGrid, { marginTop: 12 }]}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Vehicle No.</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{vehicleNo || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={vehicleNo}
                      onChangeText={setVehicleNo}
                      placeholder="e.g. UP80 AB 1234"
                      placeholderTextColor={C.textMuted}
                      autoCapitalize="characters"
                    />
                  )}
                </View>

                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Bilty No.</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{biltyNo || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={biltyNo}
                      onChangeText={setBiltyNo}
                      placeholder="Bilty / LR number"
                      placeholderTextColor={C.textMuted}
                    />
                  )}
                </View>

                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Driver Name</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{driverName || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={driverName}
                      onChangeText={setDriverName}
                      placeholder="Driver name"
                      placeholderTextColor={C.textMuted}
                    />
                  )}
                </View>

                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Driver No.</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{driverNo || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={driverNo}
                      onChangeText={setDriverNo}
                      placeholder="10-digit mobile"
                      placeholderTextColor={C.textMuted}
                      keyboardType="phone-pad"
                    />
                  )}
                </View>

                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>GRR No.</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{grrNo || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={grrNo}
                      onChangeText={setGrrNo}
                      placeholder="GRR number"
                      placeholderTextColor={C.textMuted}
                    />
                  )}
                </View>

                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Transporter Name</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{transporter || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={transporter}
                      onChangeText={setTransporter}
                      placeholder="Transporter name"
                      placeholderTextColor={C.textMuted}
                    />
                  )}
                </View>
              </View>
            </View>

            {/* ── Weight & Freight Details — filled here too ── */}
            <View style={styles.card}>
              <Text style={styles.tableTitle}>Weight Details</Text>
              <View style={[styles.fieldGrid, { marginTop: 12 }]}>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Gross Weight (kg)</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{grossWt || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={grossWt}
                      onChangeText={setGrossWt}
                      placeholder="0.000"
                      placeholderTextColor={C.textMuted}
                      keyboardType="decimal-pad"
                    />
                  )}
                </View>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Tare Weight (kg)</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{tareWt || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={tareWt}
                      onChangeText={setTareWt}
                      placeholder="0.000"
                      placeholderTextColor={C.textMuted}
                      keyboardType="decimal-pad"
                    />
                  )}
                </View>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Total Weight (kg)</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{totalWt || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={totalWt}
                      onChangeText={setTotalWt}
                      placeholder="0.000"
                      placeholderTextColor={C.textMuted}
                      keyboardType="decimal-pad"
                    />
                  )}
                </View>
              </View>

              <View style={[styles.fieldGrid, { marginTop: 16 }]}>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Total Freight (₹)</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{totalFreight || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={totalFreight}
                      onChangeText={setTotalFreight}
                      placeholder="0.00"
                      placeholderTextColor={C.textMuted}
                      keyboardType="decimal-pad"
                    />
                  )}
                </View>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Advance (₹)</Text>
                  {finalizeReadOnly ? (
                    <Text style={styles.itemNameReadOnly}>{advance || "—"}</Text>
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={advance}
                      onChangeText={setAdvance}
                      placeholder="0.00"
                      placeholderTextColor={C.textMuted}
                      keyboardType="decimal-pad"
                    />
                  )}
                </View>
                <View style={styles.fieldThird}>
                  <Text style={styles.fieldLabel}>Balance (₹)</Text>
                  <View style={styles.balanceBox}>
                    <Text style={styles.balanceBoxText}>
                      {finalizeReadOnly && activeSession?.BALANCE != null
                        ? String(activeSession.BALANCE)
                        : fmtNum(liveBalance)}
                    </Text>
                  </View>
                  <Text style={styles.balanceHint}>Auto-calculated</Text>
                </View>
              </View>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={finalizeReadOnly ? handleShareChallan : handleFinalize}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={C.textInverse} size="small" />
              ) : (
                <>
                  <Ionicons
                    name={finalizeReadOnly ? "share-outline" : "checkmark-done-outline"}
                    size={20}
                    color={C.textInverse}
                  />
                  <Text style={styles.submitBtnText}>
                    {finalizeReadOnly ? "Share Challan" : "Finalize & Share Challan"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── PPSUPERVISOR — pending queue ─────────────────────────────────────────
  if (empType === "PPSUPERVISOR" && !activeSession) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarTitle}>Dispatch Plant</Text>
            <Text style={styles.topBarSub}>{dateLabel}</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={loadPendingSessions}
          >
            <Ionicons name="refresh-outline" size={20} color={C.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.progressBarTrack} />

        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyStateText}>
              No pending dispatch sessions
            </Text>
            <Text style={styles.emptyStateSub}>
              Office will send sessions here for you to complete
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(s) => s.SESSION_ID}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                Pending Sessions ({sessions.length})
              </Text>
            }
            renderItem={({ item }) => (
              <SessionCard
                session={item}
                onSelect={openSession}
                footerText="Tap to fill loading details →"
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── PPSUPERVISOR — complete a session ────────────────────────────────────
  // Transporter Details and Weight & Freight Details are intentionally not
  // shown here: under this flow they don't exist yet at this point (office
  // fills them later, at finalize time, after this screen's action
  // completes) — they'd always render as an unbroken wall of "—", which is
  // just noise, not information.
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              setActiveSession(null);
              resetForm();
            }}
          >
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarTitle}>Complete Dispatch</Text>
            <Text style={styles.topBarSub}>
              {activeSession ? activeSession.PARTY_NM : dateLabel}
            </Text>
          </View>
          <View style={styles.ppBadge}>
            <Text style={styles.ppBadgeText}>PP Supervisor</Text>
          </View>
        </View>

        <View style={styles.progressBarTrack} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Section A ── */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>A</Text>
            </View>
            <Text style={styles.sectionTitle}>Dispatch Details</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>
              {dispatchTo === "DEPO" ? "Depo Name" : "Party Name"}
            </Text>
            <View
              style={[styles.selectorBtn, styles.selectorBtnFilled, { opacity: 0.7 }]}
            >
              <Text style={styles.selectorBtnFilledText} numberOfLines={1}>
                {partyNm}
              </Text>
            </View>

            {activeSession && (
              <View style={styles.createdRow}>
                <Ionicons name="time-outline" size={13} color={C.textMuted} />
                <Text style={styles.createdText}>
                  Created {fmtDateTime(activeSession.CREATEDAT)}
                </Text>
              </View>
            )}
          </View>

          {/* ── Items + loading entries ── */}
          <View style={styles.card}>
            <Text style={styles.tableTitle}>Item Details</Text>

            {dispItems.map((row, idx) => (
              <View
                key={row.key}
                style={[
                  styles.itemBlock,
                  idx < dispItems.length - 1 && styles.itemBlockBorder,
                ]}
              >
                <View style={styles.itemBlockHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemNameReadOnly}>
                      {row.itmnm}
                      {row.qty ? (
                        <Text style={styles.itemQtyBracket}> ({row.qty})</Text>
                      ) : null}
                    </Text>
                  </View>

                  {row.itmcd && (
                    <View style={styles.avgWtInputWrap}>
                      <Text style={styles.avgWtLabel}>Avg Wt/Box</Text>
                      <TextInput
                        style={[
                          styles.numInput,
                          row.avgWtPerBox ? styles.numInputFilled : null,
                        ]}
                        value={row.avgWtPerBox}
                        onChangeText={(v) => updateAvgWtPerBox(idx, v)}
                        keyboardType="decimal-pad"
                        placeholder="0.000"
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  )}
                </View>

                {row.itmcd && (
                  <LoadingEntriesTable
                    entries={row.loadingEntries}
                    wgtconv={row.wgtconv}
                    avgWtPerBox={row.avgWtPerBox}
                    editable
                    onAddEntry={() => addLoadingEntry(idx)}
                    onUpdateEntry={(entryIdx, field, value) =>
                      updateLoadingEntry(idx, entryIdx, field, value)
                    }
                    onRemoveEntry={(entryIdx) => removeLoadingEntry(idx, entryIdx)}
                  />
                )}
              </View>
            ))}
          </View>

          {/* ── Section B — empty material, read-only for supervisor ── */}
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionBadge, styles.sectionBadgeB]}>
              <Text style={styles.sectionBadgeText}>B</Text>
            </View>
            <Text style={styles.sectionTitle}>Empty Material Details</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colItemWide]}>
                Item Name
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            </View>
            {emptyItems.map((row, idx) => (
              <View
                key={row.key}
                style={[
                  styles.tableRow,
                  idx < emptyItems.length - 1 && styles.tableRowBorder,
                ]}
              >
                <View style={styles.colItemWide}>
                  <Text style={styles.itemNameReadOnly}>{row.itmnm}</Text>
                </View>
                <View style={styles.colQty}>
                  <Text style={styles.itemNameReadOnly}>{row.qty || "—"}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handlePPSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={C.textInverse} />
                <Text style={styles.submitBtnText}>Complete &amp; Send to Office</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: C.textMuted, fontSize: 14 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  topBarTitle: {
    color: C.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  topBarSub: { color: C.textMuted, fontSize: 12, marginTop: 1 },
  ppBadge: {
    backgroundColor: "#ECFDF5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#6EE7B7",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ppBadgeText: { color: "#065F46", fontSize: 11, fontWeight: "700" },
  wizardStatusBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  wizardStatusBadgeText: { fontSize: 11, fontWeight: "700" },

  progressBarTrack: { height: 3, backgroundColor: C.border },

  newSessionBar: { padding: 16, paddingBottom: 8 },
  newSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 13,
  },
  newSessionBtnText: { color: C.textInverse, fontSize: 14, fontWeight: "800" },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },

  listHeader: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: 40,
  },
  emptyStateText: {
    color: C.textSecondary,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyStateSub: {
    color: C.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionBadgeB: { backgroundColor: C.amber },
  sectionBadgeText: { color: C.textInverse, fontSize: 13, fontWeight: "800" },
  sectionTitle: { color: C.textPrimary, fontSize: 15, fontWeight: "700" },

  card: {
    backgroundColor: C.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },

  fieldLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },

  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleBtnActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
  },
  toggleBtnText: { color: C.textMuted, fontSize: 13, fontWeight: "600" },
  toggleBtnTextActive: { color: C.primary, fontWeight: "700" },

  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  selectorBtnFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
  },
  selectorBtnFilledText: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  selectorBtnPlaceholder: { color: C.textMuted, fontSize: 14, flex: 1 },

  createdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  createdText: { color: C.textMuted, fontSize: 12, fontWeight: "600" },

  tableTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  tableTitle: { color: C.textPrimary, fontSize: 14, fontWeight: "700" },
  addRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  addRowBtnText: { color: C.primary, fontSize: 12, fontWeight: "700" },

  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 10,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  tableRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },

  colItemWide: { flex: 5, paddingRight: 6 },
  colQty: { flex: 2, paddingHorizontal: 4 },
  colAction: { width: 28, alignItems: "center" },

  itemBlock: { paddingVertical: 10 },
  itemBlockBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemBlockHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  qtyInputWrap: { width: 76, marginLeft: 8 },
  avgWtInputWrap: { width: 90, marginLeft: 8, alignItems: "flex-end" },
  avgWtLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  itemQtyBracket: { color: C.textMuted, fontWeight: "600" },

  itemSelector: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: "center",
  },
  itemSelectorFilled: {
    backgroundColor: C.subtleBg,
    borderColor: C.primaryMuted,
  },
  itemSelectorFilledText: {
    color: C.textPrimary,
    fontSize: 12,
    fontWeight: "500",
  },
  itemSelectorPlaceholder: { color: C.textMuted, fontSize: 12 },
  itemNameReadOnly: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  numInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 7,
    fontSize: 12,
    color: C.textPrimary,
    textAlign: "center",
    fontWeight: "600",
  },
  numInputFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
    color: C.primary,
  },

  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  fieldHalf: { flexBasis: "47%", flexGrow: 1 },
  fieldThird: { flexBasis: "30%", flexGrow: 1 },
  textInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: C.textPrimary,
  },
  balanceBox: {
    backgroundColor: C.subtleBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  balanceBoxText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  balanceHint: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 3,
    fontStyle: "italic",
  },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.cardBg,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitBtnDisabled: { backgroundColor: C.primaryMuted },
  submitBtnText: { color: C.textInverse, fontSize: 15, fontWeight: "800" },
});

// ─── Loading Entries Table Styles ─────────────────────────────────────────────

const loadStyles = StyleSheet.create({
  wrap: {
    backgroundColor: C.subtleBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 6,
  },
  headCell: {
    fontSize: 9,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  colDim: { flex: 1, paddingHorizontal: 2 },
  colSub: { flex: 1, paddingHorizontal: 2, alignItems: "center" },
  colAction: { width: 24, alignItems: "center" },
  dimInput: {
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 2,
    paddingVertical: 6,
    fontSize: 11,
    color: C.textPrimary,
    textAlign: "center",
    fontWeight: "600",
  },
  dimInputFilled: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
    color: C.primary,
  },
  subtotalText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },
  emptyText: {
    color: C.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    paddingVertical: 8,
    textAlign: "center",
  },
  addEntryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 6,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMuted,
  },
  addEntryBtnText: { color: C.primary, fontSize: 11, fontWeight: "700" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalsLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  totalsValue: { fontSize: 12, fontWeight: "800", color: C.textPrimary },
  weightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  weightLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  weightValue: { fontSize: 12, fontWeight: "800", color: C.amber },
  grossWeightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  grossWeightLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  grossWeightValue: { fontSize: 12, fontWeight: "800", color: C.primary },
});

// ─── Session Card Styles ──────────────────────────────────────────────────────

const sesStyles = StyleSheet.create({
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  badgeRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  typeBadgeDepo: {
    backgroundColor: C.primaryLight,
    borderColor: C.primaryMuted,
  },
  typeBadgeParty: { backgroundColor: C.amberBg, borderColor: C.amberLight },
  typeBadgeText: { fontSize: 11, fontWeight: "700" },
  typeBadgeTextDepo: { color: C.primary },
  typeBadgeTextParty: { color: C.amber },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  time: { color: C.textMuted, fontSize: 12 },
  partyName: {
    color: C.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  itemCount: { color: C.textMuted, fontSize: 13, marginBottom: 10 },
  cardFooter: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  fillHint: { color: C.primary, fontSize: 12, fontWeight: "600" },
});

// ─── Picker Styles ────────────────────────────────────────────────────────────

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "75%",
    borderTopWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { color: C.textPrimary, fontSize: 16, fontWeight: "800" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14 },
  list: { paddingHorizontal: 12, paddingBottom: 32 },
  sectionHeader: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  itemName: { color: C.textPrimary, fontSize: 14, fontWeight: "500", flex: 1 },
  itemSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  empty: {
    color: C.textMuted,
    textAlign: "center",
    marginTop: 24,
    fontSize: 14,
  },
});