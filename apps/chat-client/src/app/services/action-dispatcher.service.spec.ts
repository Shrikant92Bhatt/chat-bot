import { describe, it, expect, vi } from 'vitest';
import { OrchestratorAction } from '@chat-monorepo/shared';
import { ActionDispatcherService } from './action-dispatcher.service';
import { ChatService } from './chat.service';

/** Minimal stand-in for ChatService - the dispatcher only ever calls sendMessage(). */
function createChatServiceStub(): ChatService {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) } as unknown as ChatService;
}

describe('ActionDispatcherService', () => {
  it('falls back to sending the label as-is for an action with no type', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    const action: OrchestratorAction = { id: 'a1', label: "What's the forecast tomorrow?" };
    dispatcher.dispatch(action);

    expect(chatService.sendMessage).toHaveBeenCalledWith("What's the forecast tomorrow?");
  });

  it('falls back to sending the label as-is for an action with an unrecognized type', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    const action: OrchestratorAction = { id: 'a1', label: 'Some other action', type: 'SOMETHING_ELSE' };
    dispatcher.dispatch(action);

    expect(chatService.sendMessage).toHaveBeenCalledWith('Some other action');
  });

  it('sends the confirmLabel text for a CONFIRM action', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    const action: OrchestratorAction = { id: 'card-1:confirm', label: 'Yes, delete it', type: 'CONFIRM' };
    dispatcher.dispatch(action);

    expect(chatService.sendMessage).toHaveBeenCalledWith('Yes, delete it');
  });

  it('sends the cancelLabel text for a CANCEL action', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    const action: OrchestratorAction = { id: 'card-1:cancel', label: 'No, keep it', type: 'CANCEL' };
    dispatcher.dispatch(action);

    expect(chatService.sendMessage).toHaveBeenCalledWith('No, keep it');
  });

  it('synthesizes a generic confirmation message when a CONFIRM action has no label', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    dispatcher.dispatch({ id: 'card-1:confirm', label: '', type: 'CONFIRM' });

    expect(chatService.sendMessage).toHaveBeenCalledWith('Yes, proceed.');
  });

  it('synthesizes a generic cancellation message when a CANCEL action has no label', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    dispatcher.dispatch({ id: 'card-1:cancel', label: '', type: 'CANCEL' });

    expect(chatService.sendMessage).toHaveBeenCalledWith('No, cancel that.');
  });

  it('dispatchLabel() sends a plain suggestion label unchanged, same as an untyped action', () => {
    const chatService = createChatServiceStub();
    const dispatcher = new ActionDispatcherService(chatService);

    dispatcher.dispatchLabel('Tell me more');

    expect(chatService.sendMessage).toHaveBeenCalledWith('Tell me more');
  });
});
