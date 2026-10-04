import { chatRepository, type ConversationWithDetails, type MessageRecord } from '../repositories/chat.repository.js';
import { BadRequestError, ForbiddenError, ErrorCode } from '../lib/errors.js';

export const chatService = {
  async getOrCreateStoreGroup(storeId: number) {
    return chatRepository.getOrCreateStoreGroup(storeId);
  },

  async getOrCreateDirect(storeId: number, currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Không thể tạo cuộc trò chuyện với chính mình');
    }
    return chatRepository.getOrCreateDirectConversation(storeId, currentUserId, targetUserId);
  },

  async listUserConversations(storeId: number, userId: string): Promise<ConversationWithDetails[]> {
    // Đảm bảo nhóm cửa hàng đã tồn tại
    await chatRepository.getOrCreateStoreGroup(storeId);
    return chatRepository.listUserConversations(storeId, userId);
  },

  async listMessages(conversationId: string, userId: string, limit = 50, beforeDate?: Date): Promise<MessageRecord[]> {
    const isMember = await chatRepository.isMember(conversationId, userId);
    if (!isMember) {
      throw new ForbiddenError('Bạn không phải là thành viên của cuộc hội thoại này');
    }
    return chatRepository.listMessages(conversationId, limit, beforeDate);
  },

  async sendMessage(conversationId: string, senderId: string, content: string): Promise<MessageRecord> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Nội dung tin nhắn không được để trống');
    }
    if (trimmed.length > 2000) {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Tin nhắn tối đa 2000 ký tự');
    }

    const isMember = await chatRepository.isMember(conversationId, senderId);
    if (!isMember) {
      throw new ForbiddenError('Bạn không phải là thành viên của cuộc hội thoại này');
    }

    return chatRepository.saveMessage(conversationId, senderId, trimmed);
  },

  async markRead(conversationId: string, userId: string): Promise<void> {
    const isMember = await chatRepository.isMember(conversationId, userId);
    if (!isMember) return;
    await chatRepository.markRead(conversationId, userId);
  },
};
