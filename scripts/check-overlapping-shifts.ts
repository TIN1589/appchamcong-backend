import { query } from '../src/db/client.js';
import { formatTimeVN } from '../src/lib/timezone.js';

interface OverlapRow {
  user_id: string;
  full_name: string;
  work_date: string;
  shift1_id: string;
  shift1_name: string;
  shift1_status: string;
  s1_start: string;
  s1_end: string;
  shift2_id: string;
  shift2_name: string;
  shift2_status: string;
  s2_start: string;
  s2_end: string;
}

export async function checkExistingOverlaps() {
  console.log('🔍 Đang kiểm tra dữ liệu ca trùng giờ trong cơ sở dữ liệu...');

  const sql = `
    SELECT 
      u.id AS user_id,
      u.full_name,
      to_char(s1.work_date, 'YYYY-MM-DD') AS work_date,
      s1.id AS shift1_id,
      COALESCE(t1.name, s1.notes, 'Ca làm việc') AS shift1_name,
      s1.status AS shift1_status,
      ss1.starts_at AS s1_start,
      ss1.ends_at AS s1_end,
      s2.id AS shift2_id,
      COALESCE(t2.name, s2.notes, 'Ca làm việc') AS shift2_name,
      s2.status AS shift2_status,
      ss2.starts_at AS s2_start,
      ss2.ends_at AS s2_end
    FROM shifts s1
    JOIN shifts s2 ON s1.assigned_to = s2.assigned_to 
                  AND s1.work_date = s2.work_date 
                  AND s1.id < s2.id
    JOIN users u ON s1.assigned_to = u.id
    LEFT JOIN shift_templates t1 ON s1.template_id = t1.id
    LEFT JOIN shift_templates t2 ON s2.template_id = t2.id
    JOIN shift_segments ss1 ON ss1.shift_id = s1.id
    JOIN shift_segments ss2 ON ss2.shift_id = s2.id
    WHERE s1.status IN ('assigned', 'scheduled', 'completed')
      AND s2.status IN ('assigned', 'scheduled', 'completed')
      AND ss1.starts_at < ss2.ends_at
      AND ss2.starts_at < ss1.ends_at
    ORDER BY s1.work_date, u.full_name;
  `;

  const res = await query<OverlapRow>(sql);

  if (res.rows.length === 0) {
    console.log('✅ Cơ sở dữ liệu sạch: Không phát hiện ca trùng giờ nào.');
    return [];
  }

  // Gom nhóm theo cặp (shift1_id, shift2_id)
  const pairMap = new Map<string, {
    userName: string;
    workDate: string;
    shift1Name: string;
    shift1Id: string;
    shift2Name: string;
    shift2Id: string;
    overlapDetails: string[];
  }>();

  for (const row of res.rows) {
    const key = `${row.shift1_id}__${row.shift2_id}`;
    const t1 = `${formatTimeVN(new Date(row.s1_start))}–${formatTimeVN(new Date(row.s1_end))}`;
    const t2 = `${formatTimeVN(new Date(row.s2_start))}–${formatTimeVN(new Date(row.s2_end))}`;
    const detail = `${row.shift1_name} (${t1}) ⚡ ${row.shift2_name} (${t2})`;

    const existing = pairMap.get(key);
    if (existing) {
      existing.overlapDetails.push(detail);
    } else {
      pairMap.set(key, {
        userName: row.full_name,
        workDate: row.work_date,
        shift1Name: row.shift1_name,
        shift1Id: row.shift1_id,
        shift2Name: row.shift2_name,
        shift2Id: row.shift2_id,
        overlapDetails: [detail],
      });
    }
  }

  console.log(`⚠️ Phát hiện ${pairMap.size} cặp ca trùng giờ:`);
  let idx = 1;
  const reports: string[] = [];
  for (const item of pairMap.values()) {
    const line = `  ${idx++}. [${item.workDate}] ${item.userName}: ${item.shift1Name} (ID: ${item.shift1Id}) và ${item.shift2Name} (ID: ${item.shift2Id}) -> Trùng đoạn: ${item.overlapDetails.join('; ')}`;
    console.log(line);
    reports.push(line);
  }

  console.log('ℹ️ Ghi chú: Dữ liệu KHÔNG bị tự động xóa; để chủ quán quyết định theo yêu cầu A3.');
  return reports;
}

if (process.argv[1]?.includes('check-overlapping-shifts')) {
  checkExistingOverlaps()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Lỗi khi kiểm tra trùng ca:', err);
      process.exit(1);
    });
}
