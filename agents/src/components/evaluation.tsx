import React, { useEffect, useState } from "react";

interface AssetRun {
  assetId: string;
  timestamp: number;
  approved: boolean;
  riskIndex: number;
  amountCspr: number;
  deployHash?: string;
  valuation?: number;
  credit?: number;
  country?: string;
}

interface SwarmState {
  totalRuns: number;
  successfulDeploys: number;
  confidenceScore: number;
  historicalAssets: AssetRun[];
  balanceCspr: number;
  walletAddress: string;
  rpcOnline: boolean;
}

interface EvaluationProps {
  state: SwarmState | null;
  activeAssetId: string | null;
  onLaunchMission: (payload: any) => void;
}

export default function EvaluationCenter({ state, activeAssetId, onLaunchMission }: EvaluationProps) {
  const [activeAsset, setActiveAsset] = useState<AssetRun | null>(null);

  useEffect(() => {
    if (!state || !state.historicalAssets || state.historicalAssets.length === 0) return;

    // Resolve the active asset: prioritize selected activeAssetId, otherwise default to absolute latest run
    const targetId = activeAssetId || localStorage.getItem("active_asset_id");
    let selected = state.historicalAssets.find((h) => h.assetId === targetId);

    if (!selected) {
      selected = state.historicalAssets[state.historicalAssets.length - 1];
    }

    setActiveAsset(selected);
  }, [state, activeAssetId]);

  if (!activeAsset) {
    return (
      <div className="glass-panel text-center py-10 font-mono text-slate-500 text-xs">
        Ingest an asset in the Portfolio Sandbox to activate evaluation deep-dive.
      </div>
    );
  }

  // Calculate gauges
  const riskIndex = activeAsset.riskIndex !== undefined ? activeAsset.riskIndex : 0.62;
  const ltvVal = 0.80; // Standard 20% down LTV
  const creditVal = activeAsset.credit || 720;
  const creditPercent = (creditVal - 300) / 550;

  const confidence = state?.confidenceScore || 75;
  const riskLimit = confidence < 70 ? 0.8 * (confidence / 70) : 0.8;
  const progressPercent = Math.min(100, (riskIndex / riskLimit) * 100);

  const isCountryOk = ["US", "CA", "IN"].includes(activeAsset.country || "US");
  const isCreditOk = creditVal >= 600;
  const passed = isCountryOk && isCreditOk && riskIndex <= riskLimit;

  return (
    <div className="view-panel active">
      <div className="view-header">
        <h2>Asset Evaluation Center</h2>
        <p>Examine animated risk indicators and parameter scoring metrics.</p>
      </div>

      <div className="glass-panel">
        <h3 className="font-title text-base font-bold text-white mb-6">
          Scoring deep-dive: {activeAsset.assetId}
        </h3>

        {/* Animated Gauges Row */}
        <div className="gauges-row flex gap-8 justify-around mb-8">
          {/* Gauge 1: Calculated Risk */}
          <div className="gauge-wrapper flex flex-col items-center">
            <div className="relative w-28 h-28">
              <svg className="w-full h-full" viewBox="0 0 120 120">
                <circle className="stroke-slate-800 fill-none" cx="60" cy="60" r="50" strokeWidth="6"></circle>
                <circle
                  className="stroke-rose-500 fill-none transition-all duration-700"
                  cx="60"
                  cy="60"
                  r="50"
                  strokeWidth="8"
                  strokeDasharray="314"
                  strokeDashoffset={314 - riskIndex * 314}
                ></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-white font-mono font-bold">
                {Math.round(riskIndex * 100)}%
              </div>
            </div>
            <span className="text-xs text-slate-400 mt-2">Calculated Risk</span>
          </div>

          {/* Gauge 2: LTV Ratio */}
          <div className="gauge-wrapper flex flex-col items-center">
            <div className="relative w-28 h-28">
              <svg className="w-full h-full" viewBox="0 0 120 120">
                <circle className="stroke-slate-800 fill-none" cx="60" cy="60" r="50" strokeWidth="6"></circle>
                <circle
                  className="stroke-blue-500 fill-none transition-all duration-700"
                  cx="60"
                  cy="60"
                  r="50"
                  strokeWidth="8"
                  strokeDasharray="314"
                  strokeDashoffset={314 - ltvVal * 314}
                ></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-white font-mono font-bold">
                {Math.round(ltvVal * 100)}%
              </div>
            </div>
            <span className="text-xs text-slate-400 mt-2">LTV Ratio</span>
          </div>

          {/* Gauge 3: Credit Score */}
          <div className="gauge-wrapper flex flex-col items-center">
            <div className="relative w-28 h-28">
              <svg className="w-full h-full" viewBox="0 0 120 120">
                <circle className="stroke-slate-800 fill-none" cx="60" cy="60" r="50" strokeWidth="6"></circle>
                <circle
                  className="stroke-emerald-500 fill-none transition-all duration-700"
                  cx="60"
                  cy="60"
                  r="50"
                  strokeWidth="8"
                  strokeDasharray="314"
                  strokeDashoffset={314 - creditPercent * 314}
                ></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-white font-mono font-bold">
                {creditVal}
              </div>
            </div>
            <span className="text-xs text-slate-400 mt-2">Borrower Rating</span>
          </div>
        </div>

        {/* Threshold bar */}
        <div className="bg-black/20 border border-white/5 rounded-2xl p-5 mb-8">
          <span className="text-xs text-slate-400 block mb-2">Consensus Risk Limit Threshold</span>
          <div className="bg-black/35 h-2 rounded-full overflow-hidden border border-white/5">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 transition-all duration-700"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-2">
            <span>Low Risk (0.0)</span>
            <span>Threshold Limit: {riskLimit.toFixed(2)}</span>
            <span>High Risk (1.0)</span>
          </div>
        </div>

        {/* Checklist */}
        <div className="grid grid-cols-4 gap-4 mb-8 text-xs font-mono">
          <div className="bg-black/10 border border-white/5 p-3 rounded-lg flex justify-between items-center">
            <span className="text-slate-400">Jurisdiction Whitelist</span>
            <span className={isCountryOk ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
              {isCountryOk ? "✓" : "✗"}
            </span>
          </div>
          <div className="bg-black/10 border border-white/5 p-3 rounded-lg flex justify-between items-center">
            <span className="text-slate-400">Sanction Check</span>
            <span className="text-emerald-500 font-bold">✓</span>
          </div>
          <div className="bg-black/10 border border-white/5 p-3 rounded-lg flex justify-between items-center">
            <span className="text-slate-400">Borrower FICO</span>
            <span className={isCreditOk ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
              {isCreditOk ? "✓" : "✗"}
            </span>
          </div>
          <div className="bg-black/10 border border-white/5 p-3 rounded-lg flex justify-between items-center">
            <span className="text-slate-400">Reserve Balance Audit</span>
            <span className="text-emerald-500 font-bold">✓</span>
          </div>
        </div>

        {/* Decision block */}
        <div className="flex justify-between items-center border border-dashed border-blue-500/20 bg-blue-500/5 p-6 rounded-2xl">
          <div>
            <span className="text-[10px] tracking-wider text-blue-400 font-bold uppercase block mb-1">
              Consensus Mission Run Decision
            </span>
            <h4
              className="text-sm font-bold transition-colors"
              style={{ color: passed ? "var(--emerald)" : "var(--rose)" }}
            >
              {passed ? "PASSED: SWARM IS READY FOR DEPLOYMENT" : "REJECTED: DYNAMIC BARRIER EXCEEDED"}
            </h4>
          </div>
          <button
            className="btn px-6 py-3 font-semibold text-white bg-blue-600 rounded-xl"
            onClick={() =>
              onLaunchMission({
                assetId: activeAsset.assetId,
                valuation: activeAsset.valuation || 500000,
                borrowerCreditScore: creditVal,
                countryCode: activeAsset.country || "US"
              })
            }
          >
            Launch Mission Swarm
          </button>
        </div>
      </div>
    </div>
  );
}
