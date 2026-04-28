/**
 * Unified pipeline refactor — Fase 0.
 *
 * In-memory implementasjon av HallPort. Map-basert lookup for haller
 * og hall-grupper. Tester konstruerer en port med pre-seedede haller
 * via `seed()` eller `setHall()`.
 */

import type { Hall, HallGroup, HallPort } from "../HallPort.js";

export class InMemoryHallPort implements HallPort {
  private readonly halls = new Map<string, Hall>();
  private readonly groups = new Map<string, HallGroup>();
  /** Reverse-map: hallId → groupId. */
  private readonly hallToGroup = new Map<string, string>();

  /** Seedfunc for å batch-registrere haller + grupper. */
  seed(input: { halls?: Hall[]; groups?: HallGroup[] }): void {
    if (input.halls) {
      for (const hall of input.halls) {
        this.setHall(hall);
      }
    }
    if (input.groups) {
      for (const group of input.groups) {
        this.setGroup(group);
      }
    }
  }

  setHall(hall: Hall): void {
    this.halls.set(hall.id, hall);
  }

  setGroup(group: HallGroup): void {
    this.groups.set(group.id, group);
    for (const hallId of group.memberHallIds) {
      this.hallToGroup.set(hallId, group.id);
    }
  }

  async getHall(hallId: string): Promise<Hall | null> {
    return this.halls.get(hallId) ?? null;
  }

  async getGroupForHall(hallId: string): Promise<HallGroup | null> {
    const groupId = this.hallToGroup.get(hallId);
    if (!groupId) return null;
    return this.groups.get(groupId) ?? null;
  }

  async isTestHall(hallId: string): Promise<boolean> {
    const hall = this.halls.get(hallId);
    return hall?.isTestHall === true;
  }

  /** Fjern alle entries — for tester som vil gjenbruke samme port. */
  clear(): void {
    this.halls.clear();
    this.groups.clear();
    this.hallToGroup.clear();
  }
}
