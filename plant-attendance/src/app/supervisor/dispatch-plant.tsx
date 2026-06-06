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

type MstItem = { itmcd: string; itmnm: string; itmsubcat: string | null };
type Party = { ledcd: string; lednm: string | null; areanm: string | null };
type Depo = { untcd: string; untnm: string; untshnm: string | null };

type DispatchItemRow = {
  key: string;
  itemId?: string;
  itmcd: string;
  itmnm: string;
  qty: string;
  fullBoxWt: string;
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
  }[];
  emptyItems: { ITEM_ID: string; ITMCD: string; ITMNM: string; QTY: string }[];
};

type PDFData = {
  dispatchTo: string;
  partyNm: string;
  vehicleNo: string;
  transporter: string;
  driverName: string;
  driverNo: string;
  kaantaWt: string;
  grrNo: string;
  items: DispatchItemRow[];
  emptyItems: EmptyItemRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);
const blankRow = (): DispatchItemRow => ({
  key: uid(),
  itmcd: "",
  itmnm: "",
  qty: "",
  fullBoxWt: "",
});
const blankEmpty = (): EmptyItemRow => ({
  key: uid(),
  itmcd: "",
  itmnm: "",
  qty: "",
});

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

  const itemRows = data.items
    .filter((r) => r.itmcd)
    .map(
      (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.itmnm}</td>
        <td class="center">${r.qty}</td>
        <td class="center">${r.fullBoxWt || "—"}</td>
      </tr>`,
    )
    .join("");

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
        <table>
          <thead>
            <tr>
              <th style="width:36px">#</th>
              <th>Item Name</th>
              <th class="center" style="width:80px">Qty</th>
              <th class="center" style="width:100px">Full Box Wt</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || `<tr><td colspan="4" class="no-data">No items added</td></tr>`}
          </tbody>
        </table>
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
        <Text style={sesStyles.fillHint}>Tap to fill box weights →</Text>
      </View>
    </TouchableOpacity>
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
          i === idx ? { ...r, itmcd: item.itmcd, itmnm: item.itmnm } : r,
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
    (idx: number, field: keyof DispatchItemRow, value: string) => {
      setDispItems((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

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
        // Generate & share PDF immediately
        await generateAndSharePDF({
          dispatchTo,
          partyNm,
          vehicleNo,
          transporter,
          driverName,
          driverNo,
          kaantaWt,
          grrNo,
          items: validDisp,
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
        fullBoxWt: i.FULL_BOX_WT != null ? String(i.FULL_BOX_WT) : "",
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
            vehicleNo,
            transporter,
            driverName,
            driverNo,
            kaantaWt,
            grrNo,
            items: dispItems.map((r) => ({
              itemId: r.itemId,
              qty: r.qty,
              fullBoxWt: r.fullBoxWt,
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
          vehicleNo,
          transporter,
          driverName,
          driverNo,
          kaantaWt,
          grrNo,
          items: dispItems,
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
          </View>

          {/* ── Items Table ── */}
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

            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colItemWide]}>
                Item Name
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
              {!isOffice && (
                <Text style={[styles.tableHeaderCell, styles.colWt]}>
                  Full Box Wt
                </Text>
              )}
              {isOffice && <View style={styles.colAction} />}
            </View>

            {dispItems.map((row, idx) => (
              <View
                key={row.key}
                style={[
                  styles.tableRow,
                  idx < dispItems.length - 1 && styles.tableRowBorder,
                ]}
              >
                <View style={styles.colItemWide}>
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
                    onChangeText={(v) => updateDispRow(idx, "qty", v)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={C.textMuted}
                  />
                </View>

                {!isOffice && (
                  <View style={styles.colWt}>
                    <TextInput
                      style={[
                        styles.numInput,
                        row.fullBoxWt ? styles.numInputFilledWt : null,
                      ]}
                      value={row.fullBoxWt}
                      onChangeText={(v) => updateDispRow(idx, "fullBoxWt", v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={C.textMuted}
                    />
                  </View>
                )}

                {isOffice && (
                  <View style={styles.colAction}>
                    {dispItems.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeDispRow(idx)}
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

          {/* ── Transport Details ── */}
          <View style={styles.card}>
            <Text style={styles.tableTitle}>Transport Details</Text>
            <View style={styles.fieldGrid}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Vehicle No.</Text>
                <TextInput
                  style={styles.textInput}
                  value={vehicleNo}
                  onChangeText={setVehicleNo}
                  placeholder="e.g. MH12AB1234"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Transporter</Text>
                <TextInput
                  style={styles.textInput}
                  value={transporter}
                  onChangeText={setTransporter}
                  placeholder="Transporter name"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Driver Name</Text>
                <TextInput
                  style={styles.textInput}
                  value={driverName}
                  onChangeText={setDriverName}
                  placeholder="Driver name"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Driver No.</Text>
                <TextInput
                  style={styles.textInput}
                  value={driverNo}
                  onChangeText={setDriverNo}
                  placeholder="Mobile number"
                  placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Kaanta Parchi Nett Wgt</Text>
                <TextInput
                  style={styles.textInput}
                  value={kaantaWt}
                  onChangeText={setKaantaWt}
                  placeholder="Net weight"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>GRR No.</Text>
                <TextInput
                  style={styles.textInput}
                  value={grrNo}
                  onChangeText={setGrrNo}
                  placeholder="GRR number"
                  placeholderTextColor={C.textMuted}
                />
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
  colWt: { flex: 2, paddingHorizontal: 4 },
  colAction: { width: 28, alignItems: "center" },

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
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
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
  numInputFilledWt: {
    backgroundColor: C.amberBg,
    borderColor: C.amberLight,
    color: C.amber,
  },

  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  fieldHalf: { width: "47%" },
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
