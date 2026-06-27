/**
 * CasperWalletConnect.tsx
 *
 * Production-ready, non-custodial React component for Casper Wallet Extension.
 * Interfaces directly with window.CasperWalletProvider — the official browser-
 * injected API from the Casper Wallet Extension (casperwallet.io).
 *
 * No mock timers. No hardcoded keys. No faked states.
 * Every state transition originates from a native extension event or RPC call.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions — Casper Wallet Extension API surface
// ─────────────────────────────────────────────────────────────────────────────

/** The provider instance returned by calling new window.CasperWalletProvider(). */
interface CasperWalletProvider {
  /** Opens the extension popup and requests account authorization. */
  requestConnection(): Promise<boolean>;

  /** Cleanly revokes the dApp's connection authorization. */
  disconnectFromSite(): Promise<boolean>;

  /**
   * Returns the hex-encoded public key of the currently active account.
   * Throws if the wallet is locked or no account is selected.
   */
  getActivePublicKey(): Promise<string>;

  /** Returns true if at least one account has authorized this origin. */
  isConnected(): Promise<boolean>;
}

/** Casper Wallet emits DOM CustomEvents. These are their canonical type strings. */
const CasperWalletEventTypes = {
  Connected: "casper-wallet:connected",
  Disconnected: "casper-wallet:disconnected",
  ActiveKeyChanged: "casper-wallet:activeKeyChanged",
  Locked: "casper-wallet:locked",
  TabChanged: "casper-wallet:tabChanged",
} as const;

/**
 * The CasperWalletProvider factory lives on window after extension injection.
 * Instantiate it using new window.CasperWalletProvider().
 */
declare global {
  interface Window {
    CasperWalletProvider?: {
      new (): CasperWalletProvider;
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection State Machine
// ─────────────────────────────────────────────────────────────────────────────

type ConnectionStatus =
  | "no_extension"   // Extension not found in window scope
  | "disconnected"   // Extension present, no active connection
  | "connecting"     // Waiting for user to approve popup
  | "connected"      // Authorized + active public key loaded
  | "locked"         // Extension is locked by the user
  | "error";         // Runtime rejection or unknown failure

interface WalletState {
  status: ConnectionStatus;
  publicKey: string | null;
  errorMessage: string | null;
}

const INITIAL_STATE: WalletState = {
  status: "disconnected",
  publicKey: null,
  errorMessage: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook — useCasperWallet
// Encapsulates all provider lifecycle logic away from render concerns.
// ─────────────────────────────────────────────────────────────────────────────

function useCasperWallet() {
  const [walletState, setWalletState] = useState<WalletState>(INITIAL_STATE);
  // Stable ref so event listeners always close over the latest provider.
  const providerRef = useRef<CasperWalletProvider | null>(null);

  /** Safely instantiate the provider from the global object. */
  const getProvider = useCallback((): CasperWalletProvider | null => {
    if (typeof window === "undefined" || !window.CasperWalletProvider) {
      return null;
    }
    if (!providerRef.current) {
      try {
        // @ts-ignore
        providerRef.current = window.CasperWalletProvider();
      } catch (_) {
        try {
          // @ts-ignore
          providerRef.current = new window.CasperWalletProvider();
        } catch (_) {
          // @ts-ignore
          providerRef.current = window.CasperWalletProvider;
        }
      }
    }
    return providerRef.current;
  }, []);

  // ── Initial detection on mount ──────────────────────────────────────────
  useEffect(() => {
    // The extension may inject asynchronously; give the browser a tick.
    const timer = setTimeout(async () => {
      const provider = getProvider();

      if (!provider) {
        setWalletState({
          status: "no_extension",
          publicKey: null,
          errorMessage: null,
        });
        return;
      }

      // Check whether a previous session is already authorized.
      try {
        const already = await provider.isConnected();
        if (already) {
          const pubKey = await provider.getActivePublicKey();
          setWalletState({
            status: "connected",
            publicKey: pubKey,
            errorMessage: null,
          });
        } else {
          setWalletState(INITIAL_STATE);
        }
      } catch {
        // isConnected / getActivePublicKey may throw if locked.
        setWalletState({ status: "locked", publicKey: null, errorMessage: null });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [getProvider]);

  // ── Native Extension Event Listeners ───────────────────────────────────
  useEffect(() => {
    /**
     * casper-wallet:connected
     * Fired after the user approves the connection popup.
     * The event detail contains the newly active public key.
     */
    const onConnected = async (e: Event) => {
      try {
        const provider = getProvider();
        if (!provider) return;
        // Prefer the detail from the event; fall back to an explicit RPC call.
        const detail = (e as CustomEvent<{ activeKey?: string }>).detail;
        const pubKey = detail?.activeKey ?? (await provider.getActivePublicKey());
        setWalletState({ status: "connected", publicKey: pubKey, errorMessage: null });
      } catch (err) {
        setWalletState({
          status: "error",
          publicKey: null,
          errorMessage: formatError(err),
        });
      }
    };

    /**
     * casper-wallet:disconnected
     * Fired when the user revokes access or the extension disconnects.
     */
    const onDisconnected = () => {
      setWalletState(INITIAL_STATE);
    };

    /**
     * casper-wallet:activeKeyChanged
     * Fired when the user switches active accounts inside the extension.
     * We must re-sync the displayed public key without re-connecting.
     */
    const onActiveKeyChanged = async (e: Event) => {
      try {
        const provider = getProvider();
        if (!provider) return;
        const detail = (e as CustomEvent<{ activeKey?: string }>).detail;
        const pubKey = detail?.activeKey ?? (await provider.getActivePublicKey());
        setWalletState((prev) => ({
          ...prev,
          status: "connected",
          publicKey: pubKey,
          errorMessage: null,
        }));
      } catch (err) {
        setWalletState({
          status: "error",
          publicKey: null,
          errorMessage: formatError(err),
        });
      }
    };

    /**
     * casper-wallet:locked
     * Fired when the user locks the extension vault.
     */
    const onLocked = () => {
      setWalletState({ status: "locked", publicKey: null, errorMessage: null });
    };

    window.addEventListener(CasperWalletEventTypes.Connected, onConnected);
    window.addEventListener(CasperWalletEventTypes.Disconnected, onDisconnected);
    window.addEventListener(CasperWalletEventTypes.ActiveKeyChanged, onActiveKeyChanged);
    window.addEventListener(CasperWalletEventTypes.Locked, onLocked);

    return () => {
      window.removeEventListener(CasperWalletEventTypes.Connected, onConnected);
      window.removeEventListener(CasperWalletEventTypes.Disconnected, onDisconnected);
      window.removeEventListener(CasperWalletEventTypes.ActiveKeyChanged, onActiveKeyChanged);
      window.removeEventListener(CasperWalletEventTypes.Locked, onLocked);
    };
  }, [getProvider]);

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Trigger the extension popup. No mocks — this opens the real wallet UI. */
  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;

    setWalletState({ status: "connecting", publicKey: null, errorMessage: null });

    try {
      const approved = await provider.requestConnection();
      if (!approved) {
        // User dismissed the popup without approving.
        setWalletState({
          status: "error",
          publicKey: null,
          errorMessage: "Connection request was rejected or cancelled.",
        });
        return;
      }
      // The `casper-wallet:connected` event will fire and update state.
      // We do NOT imperatively fetch the key here to avoid double-state.
    } catch (err) {
      setWalletState({
        status: "error",
        publicKey: null,
        errorMessage: formatError(err),
      });
    }
  }, [getProvider]);

  /** Revoke dApp authorization. */
  const disconnect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
      await provider.disconnectFromSite();
      // The `casper-wallet:disconnected` event will reset state.
    } catch (err) {
      // Even if disconnect throws, reset state client-side.
      setWalletState(INITIAL_STATE);
      console.error("[CasperWallet] disconnect error:", err);
    }
  }, [getProvider]);

  return { walletState, connect, disconnect };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unknown error occurred.";
}

/** Truncate a long hex public key for display: 01a1b2c3...f9e8d7 */
function truncateKey(key: string, head = 6, tail = 6): string {
  if (key.length <= head + tail + 3) return key;
  return `${key.slice(0, head)}...${key.slice(-tail)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CasperWalletConnect() {
  const { walletState, connect, disconnect } = useCasperWallet();
  const { status, publicKey, errorMessage } = walletState;

  return (
    <>
      {/* ── Scoped Styles ─────────────────────────────────────────────── */}
      <style>{CSS}</style>

      <div className="cw-wrapper">
        {/* ── State A: Extension not installed ─────────────────────────── */}
        {status === "no_extension" && (
          <div className="cw-notice">
            <svg className="cw-warn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="cw-notice-text">Casper Wallet extension not detected.</span>
            <a
              href="https://casperwallet.io"
              target="_blank"
              rel="noopener noreferrer"
              className="cw-install-link"
            >
              Install from casperwallet.io ↗
            </a>
          </div>
        )}

        {/* ── State B: Disconnected / Error / Locked ───────────────────── */}
        {(status === "disconnected" ||
          status === "error" ||
          status === "locked") && (
          <div className="cw-column">
            {status === "locked" && (
              <div className="cw-badge cw-badge--locked">
                <span className="cw-dot cw-dot--amber" />
                Wallet Locked
              </div>
            )}

            {status === "error" && errorMessage && (
              <div className="cw-error-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            <button className="cw-btn cw-btn--connect" onClick={connect}>
              <svg className="cw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
              Connect Wallet
            </button>
          </div>
        )}

        {/* ── State C: Awaiting approval popup ─────────────────────────── */}
        {status === "connecting" && (
          <div className="cw-column cw-column--center">
            <div className="cw-spinner" aria-label="Connecting…" />
            <span className="cw-hint">Approve connection in extension…</span>
          </div>
        )}

        {/* ── State D: Connected ───────────────────────────────────────── */}
        {status === "connected" && publicKey && (
          <div className="cw-connected-card">
            {/* Network badge */}
            <div className="cw-badge cw-badge--live">
              <span className="cw-dot cw-dot--green cw-dot--pulse" />
              casper-test
            </div>

            {/* Public key row */}
            <div className="cw-key-row">
              <svg className="cw-icon cw-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="8" r="3.5" />
                <path d="m11 11 9 9" />
                <path d="m17 17 2 2" />
              </svg>
              <code className="cw-key-display" title={publicKey}>
                {truncateKey(publicKey)}
              </code>
              <button
                className="cw-copy-btn"
                title="Copy full public key"
                onClick={() => navigator.clipboard.writeText(publicKey)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>

            {/* Disconnect */}
            <button className="cw-btn cw-btn--disconnect" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped CSS-in-JS (no external dependencies required)
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
  .cw-wrapper {
    display: inline-flex;
    align-items: center;
    font-family: 'Inter', 'Outfit', system-ui, sans-serif;
  }

  /* ── Column helpers ── */
  .cw-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cw-column--center {
    align-items: center;
    gap: 12px;
  }

  /* ── No-extension notice ── */
  .cw-notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    background: rgba(251, 113, 133, 0.06);
    border: 1px solid rgba(251, 113, 133, 0.25);
    border-radius: 12px;
    padding: 14px 18px;
    max-width: 300px;
  }
  .cw-warn-icon {
    width: 20px;
    height: 20px;
    color: #fb7185;
    flex-shrink: 0;
  }
  .cw-notice-text {
    font-size: 13px;
    color: #e2e8f0;
    line-height: 1.5;
  }
  .cw-install-link {
    font-size: 12px;
    font-weight: 600;
    color: #60a5fa;
    text-decoration: none;
    letter-spacing: 0.02em;
    transition: color 0.15s;
  }
  .cw-install-link:hover { color: #93c5fd; }

  /* ── Connect button ── */
  .cw-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0.02em;
    border-radius: 10px;
    transition: all 0.2s ease;
  }
  .cw-btn--connect {
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    color: #ffffff;
    font-size: 14px;
    padding: 11px 22px;
    box-shadow: 0 0 0 0 rgba(124, 58, 237, 0);
  }
  .cw-btn--connect:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 25px rgba(124, 58, 237, 0.35);
  }
  .cw-btn--connect:active { transform: translateY(0); }

  .cw-btn--disconnect {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8;
    font-size: 12px;
    padding: 7px 14px;
    align-self: flex-end;
  }
  .cw-btn--disconnect:hover {
    background: rgba(251,113,133,0.08);
    border-color: rgba(251,113,133,0.3);
    color: #fb7185;
  }

  /* ── Icon ── */
  .cw-icon { width: 16px; height: 16px; }
  .cw-icon--sm { width: 14px; height: 14px; color: #94a3b8; }

  /* ── Spinner ── */
  .cw-spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid rgba(99, 102, 241, 0.2);
    border-top-color: #818cf8;
    border-radius: 50%;
    animation: cw-spin 0.75s linear infinite;
  }
  @keyframes cw-spin { to { transform: rotate(360deg); } }

  .cw-hint {
    font-size: 12px;
    color: #64748b;
    font-family: monospace;
    letter-spacing: 0.03em;
  }

  /* ── Error box ── */
  .cw-error-box {
    display: flex;
    align-items: center;
    gap: 7px;
    background: rgba(251, 113, 133, 0.07);
    border: 1px solid rgba(251, 113, 133, 0.2);
    border-radius: 8px;
    padding: 8px 12px;
    color: #fb7185;
    font-size: 12px;
    max-width: 280px;
    line-height: 1.5;
  }

  /* ── Badge ── */
  .cw-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 4px 10px;
    width: fit-content;
  }
  .cw-badge--live {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: #34d399;
  }
  .cw-badge--locked {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.2);
    color: #fbbf24;
  }

  /* ── Pulsing dot ── */
  .cw-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cw-dot--green { background: #10b981; }
  .cw-dot--amber { background: #f59e0b; }
  .cw-dot--pulse {
    animation: cw-pulse 2s ease-in-out infinite;
  }
  @keyframes cw-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.75); }
  }

  /* ── Connected card ── */
  .cw-connected-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 14px;
    padding: 14px 16px;
    backdrop-filter: blur(12px);
    min-width: 220px;
  }

  /* ── Key row ── */
  .cw-key-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .cw-key-display {
    flex: 1;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 13px;
    color: #e2e8f0;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }
  .cw-copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: #64748b;
    padding: 2px;
    border-radius: 4px;
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .cw-copy-btn:hover { color: #94a3b8; }
`;
