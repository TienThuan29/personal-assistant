import { z } from 'zod/v4';
import { ASK_TOOL } from '../../shared/types';
import { askTool } from './common';

export const ASK_LIMITS = { questions: 4, options: 4, question: 200, option: 80, other: 500 } as const;

const question = z.object({
  question: z.string().trim().min(1).max(ASK_LIMITS.question).describe('Câu hỏi, ngắn gọn, cùng ngôn ngữ với người dùng'),
  options: z
    .array(z.string().trim().min(1).max(ASK_LIMITS.option))
    .max(ASK_LIMITS.options)
    .default([])
    .describe('0-4 lựa chọn khả dĩ, mỗi cái một cụm ngắn (có thể kèm ID, vd "#12 Họp team 9h"). Bỏ trống nếu câu hỏi mở. KHÔNG tự thêm "Khác/Other"'),
  multiple: z.boolean().default(false).describe('true nếu được chọn nhiều lựa chọn cùng lúc'),
});

export const askTools = [
  askTool({
    name: ASK_TOOL,
    description:
      'Hỏi người dùng khi thiếu thông tin bắt buộc, yêu cầu mơ hồ (vd nhiều bản ghi khớp), có nhiều cách hiểu, hoặc cần một câu trả lời tự do. Hiện thẻ có các lựa chọn và luôn có ô nhập "Khác"; kết quả là câu trả lời của người dùng. Gom mọi câu hỏi (tối đa 4) vào một lần gọi. Chỉ hỏi khi thật cần.',
    schema: z.object({ questions: z.array(question).min(1).max(ASK_LIMITS.questions) }),
  }),
];
