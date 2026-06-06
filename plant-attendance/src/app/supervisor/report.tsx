import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Image,
  Platform,
} from "react-native";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { API_URL } from "../../constants/config";
import { C } from "../../constants/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type AttendanceRecord = {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: string;
  todayStatus: "P" | "A" | null;
  markedAt: string | null;
  location: string | null;
  photo: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATIC_URL = API_URL.replace("/api", "");
const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDate = () =>
  new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const toBase64 = async (url: string): Promise<string | null> => {
  try {
    const localUri = FileSystem.cacheDirectory + `att_img_${Date.now()}.jpg`;
    const dl = await FileSystem.downloadAsync(url, localUri);
    const base64 = await FileSystem.readAsStringAsync(dl.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
};

// ─── PDF HTML Builder ─────────────────────────────────────────────────────────

const buildHtml = async (
  records: AttendanceRecord[],
  dateStr: string,
  apiUrl: string,
): Promise<string> => {
  const photoMap: Record<string, string> = {};
  await Promise.all(
    records.map(async (r) => {
      if (r.photo && r.todayStatus === "P") {
        const url = `${apiUrl}/uploads/${r.photo}`;
        const b64 = await toBase64(url);
        if (b64) photoMap[r.EMP_ID] = b64;
      }
    }),
  );

  const present = records.filter((r) => r.todayStatus === "P").length;
  const absent = records.filter((r) => r.todayStatus === "A").length;
  const unmarked = records.filter((r) => !r.todayStatus).length;

  const rows = records
    .map((r) => {
      const name = `${r.EMPNAME} ${r.EMPFNAME}`;
      const status =
        r.todayStatus === "P"
          ? `<span class="badge badge-p">✓ Present</span>`
          : r.todayStatus === "A"
            ? `<span class="badge badge-a">✗ Absent</span>`
            : `<span class="badge badge-u">— Unmarked</span>`;

      const time = r.todayStatus === "P" ? formatTime(r.markedAt) : "—";
      const loc = r.location || "—";
      const photoHtml =
        r.todayStatus === "P" && photoMap[r.EMP_ID]
          ? `<img src="${photoMap[r.EMP_ID]}" class="att-photo" />`
          : `<div class="no-photo">No Photo</div>`;

      return `
      <tr>
        <td class="photo-cell">${photoHtml}</td>
        <td>
          <div class="emp-name">${name}</div>
          <div class="emp-desg">${r.EMPDESG}</div>
        </td>
        <td>${status}</td>
        <td class="time-cell">${time}</td>
        <td class="loc-cell">${loc}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #fff; color: #1a1a1a; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 3px solid #2563EB; padding-bottom: 16px; }
  .header-left h1 { font-size: 22px; font-weight: 800; color: #0F172A; }
  .header-left p  { font-size: 13px; color: #888; margin-top: 4px; }
  .header-right   { text-align: right; }
  .logo-text       { font-size: 11px; color: #bbb; letter-spacing: 1px; text-transform: uppercase; }
  .stats { display: flex; gap: 12px; margin-bottom: 24px; }
  .stat  { flex: 1; border-radius: 10px; padding: 12px 16px; text-align: center; }
  .stat-p { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .stat-a { background: #fef2f2; border: 1px solid #fecaca; }
  .stat-u { background: #fffbeb; border: 1px solid #fde68a; }
  .stat-num { font-size: 28px; font-weight: 800; }
  .stat-p .stat-num { color: #16a34a; }
  .stat-a .stat-num { color: #dc2626; }
  .stat-u .stat-num { color: #d97706; }
  .stat-label { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead tr { background: #f8f8f8; }
  th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 2px solid #eee; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) { background: #fafafa; }
  .photo-cell { width: 60px; }
  .att-photo  { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; }
  .no-photo   { width: 48px; height: 48px; border-radius: 8px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #bbb; text-align: center; line-height: 1.3; padding: 4px; }
  .emp-name  { font-weight: 700; color: #1a1a1a; font-size: 13px; }
  .emp-desg  { font-size: 11px; color: #888; margin-top: 2px; }
  .badge     { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
  .badge-p   { background: #dcfce7; color: #16a34a; }
  .badge-a   { background: #fee2e2; color: #dc2626; }
  .badge-u   { background: #fef9c3; color: #ca8a04; }
  .time-cell { color: #555; font-size: 12px; white-space: nowrap; }
  .loc-cell  { color: #888; font-size: 11px; max-width: 140px; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 10px; color: #bbb; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <h1>Attendance Report</h1>
    <p>${dateStr}</p>
  </div>
  <div class="header-right">
    <div class="logo-text">Plant Attendance</div>
  </div>
</div>
<div class="stats">
  <div class="stat stat-p"><div class="stat-num">${present}</div><div class="stat-label">Present</div></div>
  <div class="stat stat-a"><div class="stat-num">${absent}</div><div class="stat-label">Absent</div></div>
  <div class="stat stat-u"><div class="stat-num">${unmarked}</div><div class="stat-label">Unmarked</div></div>
</div>
<table>
  <thead><tr><th>Photo</th><th>Employee</th><th>Status</th><th>Time</th><th>Location</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">
  <span>Generated on ${new Date().toLocaleString("en-IN")}</span>
  <span>Total: ${records.length} employees</span>
</div>
</body>
</html>`;
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AttendanceReportScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const dateStr = formatDate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/attendance/today`);
      const data = await res.json();
      if (data.success) {
        const mapped = data.data.map((emp: any) => ({
          EMP_ID: emp.EMP_ID,
          EMPNAME: emp.EMPNAME,
          EMPFNAME: emp.EMPFNAME,
          EMPDESG: emp.EMPDESG,
          EMPTYPE: emp.EMPTYPE,
          todayStatus: emp.todayAttendance?.STATUS ?? null,
          markedAt: emp.todayAttendance?.CREATEDAT ?? null,
          location: emp.todayAttendance?.LOCATION ?? null,
          photo: emp.todayAttendance?.PHOTO ?? null,
        }));
        mapped.sort((a: AttendanceRecord, b: AttendanceRecord) => {
          const order = { P: 0, A: 1, null: 2 };
          return (
            (order[a.todayStatus ?? "null"] ?? 2) -
            (order[b.todayStatus ?? "null"] ?? 2)
          );
        });
        setRecords(mapped);
      }
    } catch {
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAndShare = async () => {
    setGenerating(true);
    try {
      const html = await buildHtml(records, dateStr, STATIC_URL);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const dateTag = new Date().toISOString().slice(0, 10);
      const destUri = FileSystem.cacheDirectory + `attendance_${dateTag}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: destUri });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("Error", "Sharing is not available on this device");
        return;
      }
      await Sharing.shareAsync(destUri, {
        mimeType: "application/pdf",
        dialogTitle: "Send Attendance Report",
        UTI: "com.adobe.pdf",
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to generate PDF");
    } finally {
      setGenerating(false);
    }
  };

  const present = records.filter((r) => r.todayStatus === "P").length;
  const absent = records.filter((r) => r.todayStatus === "A").length;
  const unmarked = records.filter((r) => !r.todayStatus).length;

  const renderRow = ({ item }: { item: AttendanceRecord }) => {
    const photoUrl = item.photo ? `${STATIC_URL}/uploads/${item.photo}` : null;
    return (
      <View style={styles.row}>
        <View style={styles.rowPhoto}>
          {photoUrl && item.todayStatus === "P" ? (
            <Image source={{ uri: photoUrl }} style={styles.rowImg} />
          ) : (
            <View style={styles.rowImgPlaceholder}>
              <Ionicons name="person" size={18} color={C.textMuted} />
            </View>
          )}
        </View>

        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>
            {item.EMPNAME} {item.EMPFNAME}
          </Text>
          <Text style={styles.rowDesg}>{item.EMPDESG}</Text>
          {item.location ? (
            <Text style={styles.rowLoc} numberOfLines={1}>
              {item.location}
            </Text>
          ) : null}
        </View>

        <View style={styles.rowRight}>
          <View
            style={[
              styles.badge,
              item.todayStatus === "P"
                ? styles.badgeP
                : item.todayStatus === "A"
                  ? styles.badgeA
                  : styles.badgeU,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                item.todayStatus === "P"
                  ? styles.badgeTextP
                  : item.todayStatus === "A"
                    ? styles.badgeTextA
                    : styles.badgeTextU,
              ]}
            >
              {item.todayStatus === "P"
                ? "Present"
                : item.todayStatus === "A"
                  ? "Absent"
                  : "Pending"}
            </Text>
          </View>
          {item.todayStatus === "P" && item.markedAt ? (
            <Text style={styles.rowTime}>{formatTime(item.markedAt)}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Attendance Report</Text>
        <TouchableOpacity style={styles.backBtn} onPress={fetchData}>
          <Ionicons name="refresh" size={20} color={C.textSecondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.dateLabel}>{dateStr}</Text>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: C.greenBg, borderColor: C.greenLight }]}>
          <Text style={[styles.statNum, { color: C.green }]}>{present}</Text>
          <Text style={styles.statLabel}>Present</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.redBg, borderColor: C.redLight }]}>
          <Text style={[styles.statNum, { color: C.red }]}>{absent}</Text>
          <Text style={styles.statLabel}>Absent</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.amberBg, borderColor: C.amberLight }]}>
          <Text style={[styles.statNum, { color: C.amber }]}>{unmarked}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.EMP_ID}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.listHeader}>
              Preview · {records.length} employees
            </Text>
          }
        />
      )}

      {/* Generate button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.genBtn, generating && styles.genBtnDisabled]}
          onPress={handleGenerateAndShare}
          disabled={generating || loading}
        >
          {generating ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.genBtnText}>Generating PDF…</Text>
            </>
          ) : (
            <>
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={styles.genBtnText}>Generate & Share via WhatsApp</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.pageBg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.cardBg,
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
  topBarTitle: { color: C.textPrimary, fontSize: 16, fontWeight: "700" },
  dateLabel: {
    color: C.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginVertical: 14,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  statNum: { fontSize: 26, fontWeight: "800", marginBottom: 2 },
  statLabel: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  list: { paddingHorizontal: 20, paddingBottom: 100, gap: 8 },
  listHeader: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.cardBg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  rowPhoto: {},
  rowImg: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.border,
  },
  rowImgPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
    alignItems: "center",
  },
  rowInfo: { flex: 1 },
  rowName: { color: C.textPrimary, fontSize: 13, fontWeight: "700", marginBottom: 2 },
  rowDesg: { color: C.textMuted, fontSize: 11, marginBottom: 2 },
  rowLoc: { color: C.textMuted, fontSize: 10 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeP: { backgroundColor: C.greenLight },
  badgeA: { backgroundColor: C.redLight },
  badgeU: { backgroundColor: C.amberBg },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextP: { color: C.green },
  badgeTextA: { color: C.red },
  badgeTextU: { color: C.amber },
  rowTime: { color: C.textMuted, fontSize: 11 },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.cardBg,
  },
  genBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#25D366",
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  genBtnDisabled: { backgroundColor: C.border },
  genBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});