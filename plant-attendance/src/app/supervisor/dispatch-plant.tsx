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
  TRANSPORTER: string | null;
  DRIVER_NAME: string | null;
  DRIVER_NO: string | null;
  KAANTA_WT: string | null;
  GRR_NO: string | null;
  STATUS: string;
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
  transporter: string;
  driverName: string;
  driverNo: string;
  kaantaWt: string;
  grrNo: string;
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
            <label>Transporter</label>
            <span>${data.transporter || "—"}</span>
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
            <label>Kaanta Parchi Nett Wgt</label>
            <span>${data.kaantaWt || "—"}</span>
          </div>
          <div class="info-item">
            <label>GRR No.</label>
            <span>${data.grrNo || "—"}</span>
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

// ─── Session Card (PPSUPERVISOR view) ────────────────────────────────────────

function SessionCard({
  session,
  onSelect,
}: {
  session: Session;
  onSelect: (s: Session) => void;
}) {
  return (
    <TouchableOpacity
      style={sesStyles.card}
      onPress={() => onSelect(session)}
      activeOpacity={0.75}
    >
      <View style={sesStyles.cardTop}>
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
        <Text style={sesStyles.fillHint}>Tap to fill loading details →</Text>
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

  // PPSUPERVISOR — session list
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // Form state
  const [dispatchTo, setDispatchTo] = useState<"DEPO" | "PARTY">("DEPO");
  const [partyCd, setPartyCd] = useState("");
  const [partyNm, setPartyNm] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporter, setTransporter] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverNo, setDriverNo] = useState("");
  const [kaantaWt, setKaantaWt] = useState("");
  const [grrNo, setGrrNo] = useState("");
  const [dispItems, setDispItems] = useState<DispatchItemRow[]>([blankRow()]);
  const [emptyItems, setEmptyItems] = useState<EmptyItemRow[]>([blankEmpty()]);

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
      } else {
        // PPSUPERVISOR still needs item master data (for wgtconv, since the
        // weight calc needs weight-per-box even though the item picker itself
        // is locked for this role).
        const [itemsRes] = await Promise.all([
          fetch(`${API_URL}/dispatch/items`),
        ]);
        const itemsData = await itemsRes.json();
        if (itemsData.success) setAllItems(itemsData.data);
        await loadDraftSessions();
      }
    } catch {
      Alert.alert("Error", "Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  const loadDraftSessions = async () => {
    try {
      const res = await fetch(
        `${API_URL}/dispatch/sessions/today?status=DRAFT`,
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
    setPartyCd("");
    setPartyNm("");
    setVehicleNo("");
    setTransporter("");
    setDriverName("");
    setDriverNo("");
    setKaantaWt("");
    setGrrNo("");
    setDispItems([blankRow()]);
    setEmptyItems([blankEmpty()]);
  };

  // ── OFFICE submit ─────────────────────────────────────────────────────────

  const handleOfficeSubmit = async () => {
    if (!partyCd) {
      Alert.alert(
        "Missing",
        `Please select a ${dispatchTo === "DEPO" ? "depo" : "party"}.`,
      );
      return;
    }
    const validDisp = dispItems.filter((r) => r.itmcd && r.qty.trim());
    const validEmpty = emptyItems.filter((r) => r.itmcd && r.qty.trim());
    if (validDisp.length === 0) {
      Alert.alert("Missing", "Add at least one dispatch item with a quantity.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/dispatch/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doneBy: empId,
          dispatchTo,
          partyCd,
          partyNm,
          vehicleNo,
          transporter,
          driverName,
          driverNo,
          kaantaWt,
          grrNo,
          items: validDisp.map((r) => ({
            itmcd: r.itmcd,
            itmnm: r.itmnm,
            qty: r.qty,
          })),
          emptyItems: validEmpty.map((r) => ({
            itmcd: r.itmcd,
            itmnm: r.itmnm,
            qty: r.qty,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Generate & share PDF immediately. Office hasn't recorded loading
        // entries yet (that's the supervisor's job), so each item's entries
        // list is empty here — the PDF will show "No loading entries recorded".
        await generateAndSharePDF({
          dispatchTo,
          partyNm,
          createdAt: fmtDateTime(data.data?.CREATEDAT ?? new Date().toISOString()),
          vehicleNo,
          transporter,
          driverName,
          driverNo,
          kaantaWt,
          grrNo,
          items: validDisp.map((r) => ({
            itmnm: r.itmnm,
            qty: r.qty,
            totalBoxes: 0,
            weight: 0,
            grossWeight: 0,
            entries: [],
          })),
          emptyItems: validEmpty,
        });
        Alert.alert("Saved", "Dispatch session created.");
        resetForm();
      } else {
        Alert.alert("Error", data.message || "Failed to save");
      }
    } catch {
      Alert.alert("Error", "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── PPSUPERVISOR: open session ────────────────────────────────────────────

  const openSession = (session: Session) => {
    setActiveSession(session);
    setDispatchTo(session.DISPATCH_TO as "DEPO" | "PARTY");
    setPartyCd(session.PARTY_CD);
    setPartyNm(session.PARTY_NM);
    setVehicleNo(session.VEHICLE_NO ?? "");
    setTransporter(session.TRANSPORTER ?? "");
    setDriverName(session.DRIVER_NAME ?? "");
    setDriverNo(session.DRIVER_NO ?? "");
    setKaantaWt(session.KAANTA_WT ?? "");
    setGrrNo(session.GRR_NO ?? "");
    setDispItems(
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
    );
    setEmptyItems(
      session.emptyItems.map((i) => ({
        key: i.ITEM_ID,
        itemId: i.ITEM_ID,
        itmcd: i.ITMCD,
        itmnm: i.ITMNM,
        qty: String(i.QTY),
      })),
    );
  };

  // ── PPSUPERVISOR submit ───────────────────────────────────────────────────

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
        // Generate & share PDF immediately
        await generateAndSharePDF({
          dispatchTo,
          partyNm,
          createdAt: fmtDateTime(activeSession.CREATEDAT),
          vehicleNo,
          transporter,
          driverName,
          driverNo,
          kaantaWt,
          grrNo,
          items: dispItems.map((r) => ({
            itmnm: r.itmnm,
            qty: r.qty,
            totalBoxes: computeItemTotalBoxes(r.loadingEntries),
            weight: computeItemWeight(r.loadingEntries, r.wgtconv),
            grossWeight: computeItemGrossWeight(r.loadingEntries, r.avgWtPerBox),
            entries: r.loadingEntries,
          })),
          emptyItems: emptyItems,
        });
        Alert.alert("Completed", "Dispatch session completed.");
        setActiveSession(null);
        resetForm();
        await loadDraftSessions();
      } else {
        Alert.alert("Error", data.message || "Failed");
      }
    } catch {
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

  // PPSUPERVISOR — session list
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
            onPress={loadDraftSessions}
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
              Office will create entries for you to complete
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
              <SessionCard session={item} onSelect={openSession} />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    );
  }

  // OFFICE form or PPSUPERVISOR editing a session
  const isOffice = empType === "OFFICE";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (activeSession) {
                setActiveSession(null);
                resetForm();
              } else router.back();
            }}
          >
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarTitle}>
              {isOffice ? "New Dispatch" : "Complete Dispatch"}
            </Text>
            <Text style={styles.topBarSub}>
              {activeSession ? activeSession.PARTY_NM : dateLabel}
            </Text>
          </View>
          {!isOffice && (
            <View style={styles.ppBadge}>
              <Text style={styles.ppBadgeText}>PP Supervisor</Text>
            </View>
          )}
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
                  if (isOffice) {
                    setDispatchTo("DEPO");
                    setPartyCd("");
                    setPartyNm("");
                  }
                }}
                disabled={!isOffice}
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
                  if (isOffice) {
                    setDispatchTo("PARTY");
                    setPartyCd("");
                    setPartyNm("");
                  }
                }}
                disabled={!isOffice}
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
            {isOffice ? (
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
            ) : (
              <View
                style={[
                  styles.selectorBtn,
                  styles.selectorBtnFilled,
                  { opacity: 0.7 },
                ]}
              >
                <Text style={styles.selectorBtnFilledText} numberOfLines={1}>
                  {partyNm}
                </Text>
              </View>
            )}

            {/* Created date/time — only meaningful once a session actually
                exists in the DB, i.e. the supervisor is editing one. */}
            {activeSession && (
              <View style={styles.createdRow}>
                <Ionicons name="time-outline" size={13} color={C.textMuted} />
                <Text style={styles.createdText}>
                  Created {fmtDateTime(activeSession.CREATEDAT)}
                </Text>
              </View>
            )}
          </View>

          {/* ── Items ── */}
          <View style={styles.card}>
            <View style={styles.tableTitleRow}>
              <Text style={styles.tableTitle}>Item Details</Text>
              {isOffice && (
                <TouchableOpacity
                  style={styles.addRowBtn}
                  onPress={() => setDispItems((p) => [...p, blankRow()])}
                >
                  <Ionicons name="add" size={16} color={C.primary} />
                  <Text style={styles.addRowBtnText}>Add Row</Text>
                </TouchableOpacity>
              )}
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
                    {isOffice ? (
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
                    ) : (
                      <Text style={styles.itemNameReadOnly}>
                        {row.itmnm}
                        {row.qty ? (
                          <Text style={styles.itemQtyBracket}> ({row.qty})</Text>
                        ) : null}
                      </Text>
                    )}
                  </View>

                  {/* Avg weight per box — supervisor-entered actual measured
                      value, distinct from the catalog wgtconv rate. Only
                      shown once the supervisor is completing a session and
                      an item is chosen. */}
                  {!isOffice && row.itmcd && (
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

                  {isOffice ? (
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
                  ) : null}

                  {isOffice && dispItems.length > 1 && (
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

                {/* Loading table only makes sense once an item is chosen, and
                    is the supervisor's job to fill in — office just picks
                    items/qty and never sees this table. */}
                {!isOffice && row.itmcd && (
                  <LoadingEntriesTable
                    entries={row.loadingEntries}
                    wgtconv={row.wgtconv}
                    avgWtPerBox={row.avgWtPerBox}
                    editable={!isOffice}
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

          {/* ── Transport Details ──
              Editable by OFFICE only (they're the ones who know the vehicle
              at dispatch-creation time). PPSUPERVISOR sees the same values
              read-only, matching how party name / item rows are handled
              above — the supervisor's job is loading entries, not transport. */}
          <View style={styles.card}>
            <Text style={styles.tableTitle}>Transport Details</Text>
            <View style={[styles.fieldGrid, { marginTop: 12 }]}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Vehicle No.</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={vehicleNo}
                    onChangeText={setVehicleNo}
                    placeholder="e.g. UP80 AB 1234"
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="characters"
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{vehicleNo || "—"}</Text>
                )}
              </View>

              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Transporter</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={transporter}
                    onChangeText={setTransporter}
                    placeholder="Transporter name"
                    placeholderTextColor={C.textMuted}
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{transporter || "—"}</Text>
                )}
              </View>

              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Driver Name</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={driverName}
                    onChangeText={setDriverName}
                    placeholder="Driver name"
                    placeholderTextColor={C.textMuted}
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{driverName || "—"}</Text>
                )}
              </View>

              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Driver No.</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={driverNo}
                    onChangeText={setDriverNo}
                    placeholder="10-digit mobile"
                    placeholderTextColor={C.textMuted}
                    keyboardType="phone-pad"
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{driverNo || "—"}</Text>
                )}
              </View>

              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Kaanta Parchi Nett Wgt</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={kaantaWt}
                    onChangeText={setKaantaWt}
                    placeholder="e.g. 12500"
                    placeholderTextColor={C.textMuted}
                    keyboardType="decimal-pad"
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{kaantaWt || "—"}</Text>
                )}
              </View>

              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>GRR No.</Text>
                {isOffice ? (
                  <TextInput
                    style={styles.textInput}
                    value={grrNo}
                    onChangeText={setGrrNo}
                    placeholder="GRR number"
                    placeholderTextColor={C.textMuted}
                  />
                ) : (
                  <Text style={styles.itemNameReadOnly}>{grrNo || "—"}</Text>
                )}
              </View>
            </View>
          </View>

          {/* ── Section B ── */}
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionBadge, styles.sectionBadgeB]}>
              <Text style={styles.sectionBadgeText}>B</Text>
            </View>
            <Text style={styles.sectionTitle}>Empty Material Details</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tableTitleRow}>
              <Text style={styles.tableTitle}>Items</Text>
              {isOffice && (
                <TouchableOpacity
                  style={styles.addRowBtn}
                  onPress={() => setEmptyItems((p) => [...p, blankEmpty()])}
                >
                  <Ionicons name="add" size={16} color={C.primary} />
                  <Text style={styles.addRowBtnText}>Add Row</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colItemWide]}>
                Item Name
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
              {isOffice && <View style={styles.colAction} />}
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
                  {isOffice ? (
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
                  ) : (
                    <Text style={styles.itemNameReadOnly}>{row.itmnm}</Text>
                  )}
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
                {isOffice && (
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
                )}
              </View>
            ))}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={isOffice ? handleOfficeSubmit : handlePPSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={C.textInverse} size="small" />
            ) : (
              <>
                <Ionicons
                  name={
                    isOffice
                      ? "cloud-upload-outline"
                      : "checkmark-circle-outline"
                  }
                  size={20}
                  color={C.textInverse}
                />
                <Text style={styles.submitBtnText}>
                  {isOffice
                    ? "Save & Share Challan"
                    : "Complete & Share Challan"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Pickers */}
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

  progressBarTrack: { height: 3, backgroundColor: C.border },

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