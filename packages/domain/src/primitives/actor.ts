import { DomainValueError } from "./errors.ts";

export const ACTOR_KINDS = ["human", "agent", "service", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

export class ActorRef {
  readonly kind: ActorKind;
  readonly id: string;

  private constructor(kind: ActorKind, id: string) {
    this.kind = kind;
    this.id = id;
    Object.freeze(this);
  }

  static create(kind: string, id: string): ActorRef {
    if (!ACTOR_KINDS.includes(kind as ActorKind) || !ACTOR_ID_PATTERN.test(id)) {
      throw new DomainValueError("VES_ACTOR_INVALID", "Actor reference is not canonical");
    }
    return new ActorRef(kind as ActorKind, id);
  }

  toJSON(): { readonly kind: ActorKind; readonly id: string } {
    return { kind: this.kind, id: this.id };
  }
}
