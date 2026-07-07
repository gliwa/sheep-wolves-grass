import { describe, expect, it } from 'vitest';

import { MAX_NAME_LENGTH, parseClientMessage } from './protocol';

describe('parseClientMessage', () => {
  it('parses every valid message type', () => {
    expect(parseClientMessage('{"type":"setName","name":"Peter"}')).toEqual({
      type: 'setName',
      name: 'Peter',
    });
    expect(parseClientMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseClientMessage('{"type":"addBot"}')).toEqual({ type: 'addBot' });
    expect(parseClientMessage('{"type":"voteChess"}')).toEqual({ type: 'voteChess' });
    expect(parseClientMessage('{"type":"exit"}')).toEqual({ type: 'exit' });
    expect(parseClientMessage('{"type":"move","entity":"sheep","dir":"up"}')).toEqual({
      type: 'move',
      entity: 'sheep',
      dir: 'up',
    });
  });

  it('returns null for malformed payloads', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('{"type":"fly"}')).toBeNull();
    expect(parseClientMessage('{"type":"move","entity":"goat","dir":"up"}')).toBeNull();
    expect(parseClientMessage('{"type":"move","entity":"sheep","dir":"north"}')).toBeNull();
    expect(parseClientMessage('{"type":"setName","name":""}')).toBeNull();
    expect(
      parseClientMessage(`{"type":"setName","name":"${'x'.repeat(MAX_NAME_LENGTH + 1)}"}`),
    ).toBeNull();
  });
});
