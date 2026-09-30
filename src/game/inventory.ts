import { ItemStack, getItem, sameItem, cloneStack } from './items';

export type Slots = (ItemStack | null)[];

export class Inventory {
  main: Slots = new Array(36).fill(null); // 0-8 hotbar, 9-35 storage
  armor: Slots = new Array(4).fill(null); // helmet, chest, legs, boots
  selected = 0;

  held(): ItemStack | null {
    return this.main[this.selected];
  }
  setHeld(s: ItemStack | null) {
    this.main[this.selected] = s;
  }

  /** Try to add a stack; returns how many items could NOT be added. */
  add(s: ItemStack): number {
    return addToSlots(this.main, s, [...hotbarFirst()]);
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.main) if (s && s.id === id) n += s.count;
    return n;
  }

  remove(id: number, n: number): boolean {
    if (this.count(id) < n) return false;
    for (let i = 0; i < this.main.length && n > 0; i++) {
      const s = this.main[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.count);
        s.count -= k;
        n -= k;
        if (s.count <= 0) this.main[i] = null;
      }
    }
    return true;
  }

  armorPoints(): number {
    let p = 0;
    for (const s of this.armor) if (s) p += getItem(s.id).armor?.points ?? 0;
    return p;
  }

  clear() {
    this.main.fill(null);
    this.armor.fill(null);
  }

  toJSON() {
    return { main: this.main, armor: this.armor, selected: this.selected };
  }
  load(d: { main: Slots; armor: Slots; selected: number }) {
    this.main = d.main.map(cloneStack);
    while (this.main.length < 36) this.main.push(null);
    this.armor = (d.armor ?? [null, null, null, null]).map(cloneStack);
    this.selected = d.selected ?? 0;
  }
}

function* hotbarFirst() {
  for (let i = 0; i < 36; i++) yield i;
}

export function addToSlots(slots: Slots, s: ItemStack, order: number[]): number {
  let left = s.count;
  const max = getItem(s.id).maxStack;
  // merge into existing stacks
  for (const i of order) {
    const t = slots[i];
    if (t && sameItem(t, s) && t.count < max) {
      const k = Math.min(max - t.count, left);
      t.count += k;
      left -= k;
      if (!left) return 0;
    }
  }
  for (const i of order) {
    if (!slots[i]) {
      const k = Math.min(max, left);
      slots[i] = { ...s, count: k, damage: s.damage ?? 0 };
      left -= k;
      if (!left) return 0;
    }
  }
  return left;
}
