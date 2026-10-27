import { h, toast } from '../chrome';
import { go } from '../nav';
import { sitePath } from '../paths';
import { publishAll } from './mqtt';
import { drawFragment, encodeCommand, formatPlayerId, playerTopic, wallFragment, WALL_LEAD } from './protocol';
import { readRoster, setPlayerOn } from './roster';

/**
 * Send the current sign to every checked player. The studio's 发送 button
 * opens this; the controller console plays by itself and does not come through
 * here. Checkboxes stick to the stored roster.
 */
export function openSendDialog(fragment: string): () => void {
  const roster = readRoster();
  const dialog = h('dialog', { class: 'send-dialog' }) as HTMLDialogElement;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  if (roster.length === 0) {
    const add = h('a', { class: 'btn btn-primary', href: sitePath('/?role=control') }, '去控制端添加播放器');
    add.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      close();
      go('/?role=control');
    });
    dialog.append(h('h2', {}, '还没有播放器'), h('p', {}, '先在控制端把播放器加进来，一台手机可以控制多台。'), add);
  } else {
    const boxes = new Map<string, HTMLInputElement>();
    const rows = roster.map((player) => {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
      box.checked = player.on;
      boxes.set(player.id, box);
      box.addEventListener('change', () => setPlayerOn(player.id, box.checked));
      return h(
        'label',
        { class: 'send-player' },
        box,
        h('span', { class: 'control-slot' }, String(player.slot)),
        h('span', { class: 'control-id' }, formatPlayerId(player.id)),
      );
    });
    const submit = h('button', { class: 'btn btn-primary', type: 'button' }, '发送') as HTMLButtonElement;
    const wallBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    wallBox.id = 'send-wall';
    const wallRow = h('label', { class: 'send-wall', for: 'send-wall' }, wallBox, h('span', {}, '拼接屏（多台屏幕拼成一块大牌子）'));
    const drawBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    drawBox.id = 'send-draw';
    const drawRow = h('label', { class: 'send-wall', for: 'send-draw' }, drawBox, h('span', {}, '抽奖（色块在屏幕间穿梭，停在哪台上哪台中奖）'));
    const refreshWall = () => {
      const count = roster.filter((player) => boxes.get(player.id)?.checked).length;
      // One screen is a sign on its own, so there is nothing to join up. A
      // draw needs someone to beat, and it always spans the screens itself,
      // so it leaves no room for the wall option.
      const usable = count > 1;
      for (const [box, row] of [
        [wallBox, wallRow],
        [drawBox, drawRow],
      ] as const) {
        box.disabled = !usable;
        if (!usable) box.checked = false;
        row.classList.toggle('send-wall-off', !usable);
      }
      if (drawBox.checked) {
        wallBox.checked = false;
        wallBox.disabled = true;
      }
    };
    for (const box of boxes.values()) box.addEventListener('change', refreshWall);
    wallBox.addEventListener('change', () => {
      if (wallBox.checked) drawBox.checked = false;
    });
    drawBox.addEventListener('change', () => {
      if (drawBox.checked) wallBox.checked = false;
    });
    refreshWall();
    submit.addEventListener('click', () => {
      const chosen = roster.filter((player) => boxes.get(player.id)?.checked);
      if (chosen.length === 0) {
        toast('请选择播放器');
        return;
      }
      const asDraw = drawBox.checked && chosen.length > 1;
      const asWall = !asDraw && wallBox.checked && chosen.length > 1;
      // The seed decides the winner, so it is picked here once and shared by
      // every screen; each then works out the same flight on its own.
      const seed = 1 + Math.floor(Math.random() * 0x7ffffffe);
      submit.disabled = true;
      const items = chosen.map((player, index) => ({
        broker: player.broker,
        topic: playerTopic(player.id),
        payload: encodeCommand(
          asDraw
            ? drawFragment(index + 1, chosen.length, seed)
            : asWall
              ? wallFragment(fragment, index + 1, chosen.length)
              : fragment,
        ),
      }));
      void publishAll(items)
        .then(() => {
          toast(asDraw ? `抽奖开始！${chosen.length} 台，色块停下前谁都可能是赢家` : asWall ? `已把 ${chosen.length} 台拼成一块牌子` : `已发送到 ${chosen.length} 台播放器`);
          close();
        })
        .catch(() => {
          submit.disabled = false;
          toast('发送失败，请检查网络');
        });
    });
    dialog.append(
      h('h2', {}, '发送到播放器'),
      h('p', {}, WALL_LEAD),
      h('div', { class: 'send-list' }, ...rows),
      wallRow,
      drawRow,
      submit,
    );
  }
  const cancel = h('button', { class: 'btn', type: 'button' }, '取消');
  cancel.addEventListener('click', close);
  dialog.append(cancel);
  document.body.append(dialog);
  dialog.showModal();
  return close;
}
