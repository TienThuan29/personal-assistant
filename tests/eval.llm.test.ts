import { buildLlmMessages } from '../src/main/agent';
import { collect, createLlm } from '../src/main/llm';
import { addMessage, createConversation } from '../src/main/store';
import { toOpenAITools } from '../src/main/tools';
import { DEFAULT_LLM } from '../src/shared/types';
import { testDeps } from './helpers';

const { LLM_PROVIDER, LLM_ENDPOINT, LLM_MODEL, LLM_KEY, LLM_API_VERSION } = process.env;

/** [prompt, acceptable first tool]. An empty list means the model should reply or ask back, with no tool. */
const CASES: [string, string[]][] = [
  ['Hôm nay tôi có việc gì?', ['get_today_overview', 'list_tasks']],
  ['Tuần này có task công việc nào?', ['list_tasks']],
  ['Task nào đang quá hạn?', ['get_today_overview', 'list_tasks']],
  ['Thêm task mai 9h họp team dự án Alpha, ưu tiên cao', ['create_task']],
  ['Mỗi thứ 2 và thứ 4 đi tập gym, bắt đầu từ tuần sau', ['create_task']],
  ['Nhắc tôi uống thuốc lúc 21h tối nay', ['create_reminder']],
  ['Có nhắc nhở nào ngày mai không?', ['list_reminders']],
  ['Xóa nhắc nhở uống thuốc', ['list_reminders']],
  ['Ghi chú: ý tưởng app học tiếng Nhật bằng flashcard', ['create_note']],
  ['Viết nhật ký: hôm nay chạy bộ 5km, thấy khỏe', ['create_note']],
  ['Tôi đã ghi gì về ngân sách?', ['search_notes']],
  ['Vừa ăn phở hết 55k', ['create_expense']],
  ['Tháng này tôi tiêu bao nhiêu cho ăn uống?', ['list_expenses', 'query_readonly_sql']],
  ['So sánh chi tiêu tháng này với tháng trước theo danh mục', ['query_readonly_sql', 'list_expenses']],
  ['Tháng 9 tôi hoàn thành bao nhiêu task?', ['query_readonly_sql', 'list_tasks']],
  ['Đánh dấu xong task họp team', ['list_tasks']],
  ['Dời hết task hôm nay sang mai', ['list_tasks', 'get_today_overview']],
  ['Tôi vừa chi tiền', []],
  ['Thêm task', []],
  ['Chào bạn', []],
];

describe.skipIf(!LLM_ENDPOINT || !LLM_MODEL || !LLM_KEY)('LLM tool choice (real endpoint)', () => {
  const llm = () =>
    createLlm(
      { provider: LLM_PROVIDER === 'azure' ? 'azure' : 'gateway', endpoint: LLM_ENDPOINT!, model: LLM_MODEL!, apiVersion: LLM_API_VERSION ?? DEFAULT_LLM.azure.apiVersion },
      LLM_KEY!
    );

  it.each(CASES)('%s', async (prompt, expected) => {
    const deps = testDeps([], llm());
    const conv = createConversation(deps.db);
    addMessage(deps.db, conv, { role: 'user', content: prompt });
    const reply = await collect(deps.llm().stream({ messages: buildLlmMessages(deps, conv), tools: toOpenAITools() }), () => {});
    const first = reply.tool_calls?.[0]?.function.name;
    if (expected.length) expect(expected).toContain(first);
    else expect(first).toBeUndefined();
  }, 60_000);
});
