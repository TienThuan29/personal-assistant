/** Vietnamese, the default language and the source of the key set. */
export const vi = {
  common: {
    empty: '(trống)',
  },
  chat: {},
  pages: {},
  settings: {},
  errors: {
    // zod messages (schemas carry 'errors:<key>')
    dateFormat: 'Định dạng YYYY-MM-DD',
    dateInvalid: 'Ngày không tồn tại',
    timeFormat: 'Định dạng HH:MM',
    instantFormat: 'Cần ngày YYYY-MM-DD hoặc thời điểm ISO 8601, vd 2026-09-29T09:00',
    remindAtFormat: 'Cần thời điểm có giờ, vd 2026-09-29T09:00',
    currencyFormat: 'Mã tiền tệ ISO 4217 gồm 3 chữ cái, vd VND, USD',
    emptyPatch: 'patch không được rỗng',
    endpointUrl: 'Endpoint chưa đúng dạng URL (vd https://…)',
    endpointHttps: 'Endpoint phải dùng https',
    modelRequired: 'Chưa nhập model/deployment',
    apiVersionRequired: 'Chưa nhập API version',
    // tools
    notFound: 'Không tìm thấy {{table}} #{{ids}}',
    reminderPast: 'Thời điểm nhắc đã qua',
    sqlSelectOnly: 'Chỉ chấp nhận SELECT hoặc WITH',
    // LLM
    llmNotConfigured: 'Chưa cấu hình LLM. Mở Cài đặt để nhập endpoint, model và key.',
    llmTruncated: 'Câu trả lời bị cắt (vượt giới hạn độ dài hoặc bị bộ lọc nội dung chặn). Thử lại hoặc chia nhỏ yêu cầu.',
    llmStopped: 'Đã dừng.',
    llmConnection: 'Không kết nối được tới LLM endpoint. Kiểm tra mạng/proxy và URL trong Cài đặt.',
    llmAuth: 'API key/token sai hoặc hết hạn. Kiểm tra trong Cài đặt.',
    llmModelNotFound: 'Không tìm thấy model/deployment. Kiểm tra endpoint và tên model trong Cài đặt.',
    llmContextLength: 'Hội thoại quá dài, hãy tạo hội thoại mới.',
    llmContentFilter: 'Yêu cầu bị bộ lọc nội dung của LLM chặn. Hãy diễn đạt lại.',
    llmRateLimit: 'LLM đang giới hạn tốc độ (429). Thử lại sau ít phút.',
    llmError: 'LLM trả lỗi: {{message}}',
    // agent
    maxRounds: 'Mình dừng lại vì yêu cầu này đã dùng quá {{max}} bước. Bạn thử chia nhỏ yêu cầu nhé.',
    emptyReply: 'Mô hình không trả lời. Hãy thử lại.',
    interrupted: '(bị gián đoạn)',
    unknownTool: 'Không có tool {{name}}',
    unknownWriteTool: 'Không có tool ghi {{name}}',
    invalidArgs: 'Tham số không hợp lệ: {{error}}',
    actionResolved: 'Thao tác này đã được xử lý',
    // IPC validation
    invalidId: 'ID không hợp lệ',
    invalidImage: 'Ảnh không hợp lệ hoặc lớn hơn {{mb}}MB',
    imageType: 'Chỉ hỗ trợ ảnh PNG hoặc JPEG',
    invalidMessage: 'Tin nhắn không hợp lệ',
    tooManyImages: 'Tối đa {{max}} ảnh mỗi tin nhắn',
    emptyMessage: 'Tin nhắn trống',
    invalidDecision: 'Quyết định không hợp lệ',
    notAllowed: 'Không cho phép: {{name}}',
    invalidApiKey: 'API key không hợp lệ',
    invalidValue: 'Giá trị không hợp lệ',
    // startup
    noEncryption: 'Hệ điều hành không hỗ trợ mã hóa (safeStorage)',
    dbTooNew: 'Cơ sở dữ liệu được tạo bởi phiên bản mới hơn của ứng dụng',
    startupFailed: 'Không khởi động được Trợ lý',
  },
  system: {},
} as const;

type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
/** The shape every language must fill: the same keys as `vi`, any strings. */
export type Resources = Strings<typeof vi>;
