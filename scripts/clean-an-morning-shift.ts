import { query } from '../src/db/client.js';

async function main() {
  console.log('🔄 Đang xóa assignment Ca sáng của Nguyễn Văn An ngày 02/10/2026...');

  // Truy vấn tìm chính xác ca sáng của An ngày 02/10/2026
  const findRes = await query<{ id: string; status: string; full_name: string; name: string }>(`
    SELECT s.id, s.status, u.full_name, COALESCE(t.name, s.notes, 'Ca sáng') as name
    FROM shifts s
    JOIN users u ON s.assigned_to = u.id
    LEFT JOIN shift_templates t ON s.template_id = t.id
    WHERE u.full_name = 'Nguyễn Văn An'
      AND s.work_date = '2026-10-02'
      AND (t.name ILIKE '%sáng%' OR s.id = '4730da27-3fae-44af-806e-a96553fa9311')
  `);

  if (findRes.rows.length === 0) {
    console.log('ℹ️ Không tìm thấy ca sáng nào của Nguyễn Văn An ngày 02/10/2026.');
    process.exit(0);
  }

  const shiftToClean = findRes.rows[0]!;
  console.log(`📌 Tìm thấy ca: ${shiftToClean.name} (ID: ${shiftToClean.id}, Trạng thái: ${shiftToClean.status})`);

  // Xóa shift_segments của ca này và ca này (hoặc mở lại ca nếu là template)
  // Theo SRS: xóa ca assignment bị trùng
  const delSegments = await query(`DELETE FROM shift_segments WHERE shift_id = $1`, [shiftToClean.id]);
  const delShift = await query(`DELETE FROM shifts WHERE id = $1 RETURNING id`, [shiftToClean.id]);

  console.log(`✅ Đã xóa ${delSegments.rowCount ?? 0} segments.`);
  console.log(`✅ Đã xóa ${delShift.rowCount ?? 0} dòng shift (ID: ${shiftToClean.id}).`);
  console.log('🎉 Hoàn tất dọn dữ liệu Ca sáng 02/10 của Nguyễn Văn An.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Lỗi khi dọn dữ liệu:', err);
  process.exit(1);
});
