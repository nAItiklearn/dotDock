import { useState, type RefObject } from "react";
import { actions } from "./bridge";
import type { ConnectionStatus } from "./protocol";
import { t } from "./strings";

/** Set once the user answered the offer, with either button: it never shows again on this PC (D-046). */
export const OFFER_ANSWERED_KEY = "dotdock.island.connectOffer";

export function offerAnswered(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(OFFER_ANSWERED_KEY) !== null;
  } catch {
    return false;
  }
}

function markAnswered(answer: "connected" | "declined", storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(OFFER_ANSWERED_KEY, answer);
  } catch {
    // Storage that cannot be written only means the offer may show once more.
  }
}

/**
 * Whether the idle notch offers to connect Claude Code: it is installed, it is not connected, no agent is working, and
 * the user has not answered before. Connecting edits the user's Claude Code settings, so it is only ever asked for.
 */
export function shouldOffer(connection: ConnectionStatus | null, answered: boolean, busy: boolean): boolean {
  return !answered && !busy && connection?.state === "disconnected";
}

interface ConnectOfferProps {
  readonly offerRef: RefObject<HTMLDivElement | null>;
  readonly onAnswered: () => void;
}

/** The one-time offer under the idle notch: Connect (the same reversible Connect as Settings) or Not now. */
export function ConnectOffer({ offerRef, onAnswered }: ConnectOfferProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const connect = (): void => {
    setBusy(true);
    setFailed(false);
    actions
      .connect()
      .then(() => {
        markAnswered("connected");
        onAnswered();
      })
      .catch((err: unknown) => {
        console.error("connecting Claude Code from the notch failed", err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };
  const decline = (): void => {
    markAnswered("declined");
    onAnswered();
  };

  return (
    <div ref={offerRef} className="connect-offer" role="group" aria-label={t("offer.title")}>
      <i className="connect-offer__dot" aria-hidden="true" />
      <span className="connect-offer__text">{failed ? t("connection.failed") : t("offer.title")}</span>
      <button type="button" className="connect-offer__button connect-offer__button--primary" disabled={busy} onClick={connect}>
        {busy ? t("connection.busy") : t("connection.connect")}
      </button>
      <button type="button" className="connect-offer__button" disabled={busy} onClick={decline}>
        {t("offer.later")}
      </button>
    </div>
  );
}
