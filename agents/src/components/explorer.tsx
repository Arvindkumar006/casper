import React, { useState } from "react";

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

interface ExplorerProps {
  state: SwarmState | null;
}

export default function ExplorerLedger({ state }: ExplorerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filterAssetId, setFilterAssetId] = useState<string | null>(null);

  if (!state || !state.historicalAssets || state.historicalAssets.length === 0) {
    return (
      <div className="glass-panel p-6 text-center text-slate-500 font-mono text-xs border border-white/5 rounded-xl bg-slate-950/20">
        No deployment logs found in database.
      </div>
    );
  }

  // Filter logs dynamically from the single source of truth array
  let logs = [...state.historicalAssets].reverse();
  if (filterAssetId) {
    logs = logs.filter((l) => l.assetId === filterAssetId);
  }

  const toggleExpand = (idx: number) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <div className="view-panel active">
      <div className="view-header">
        <h2>Ledger Blockchain Explorer</h2>
        <p>Audit deployment trails, gas consumption limits, and target transaction confirmations.</p>
        
        {filterAssetId && (
          <div className="mt-3 flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 p-2 px-3 rounded-lg font-mono text-xs text-blue-400 w-fit">
            <span>Filtering by Asset ID: <strong>{filterAssetId}</strong></span>
            <button
              onClick={() => setFilterAssetId(null)}
              className="text-rose-500 font-bold hover:underline"
            >
              [Clear Filter]
            </button>
          </div>
        )}
      </div>

      {/* KPI status row */}
      <div className="grid grid-cols-5 gap-4 mb-6 text-xs font-mono">
        <div className="bg-black/10 border border-white/5 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase block mb-1">Latest Block</span>
          <span className="text-white font-bold">{482912 + state.totalRuns}</span>
        </div>
        <div className="bg-black/10 border border-white/5 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase block mb-1">Gas Payment Limit</span>
          <span className="text-white font-bold">500 CSPR</span>
        </div>
        <div className="bg-black/10 border border-white/5 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase block mb-1">Motes Allocation Limit</span>
          <span className="text-white font-bold">500,000,000,000</span>
        </div>
        <div className="bg-black/10 border border-white/5 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase block mb-1">Active Contract</span>
          <span className="text-white font-bold truncate block">NexusVault Hash</span>
        </div>
        <div className="bg-black/10 border border-white/5 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase block mb-1">Target Chain</span>
          <span className="text-emerald-400 font-bold">casper-test</span>
        </div>
      </div>

      <div className="glass-panel">
        <h3 className="text-sm font-bold text-white mb-5 font-title">
          On-Chain Deployment Ledger Logs
        </h3>

        <div className="flex flex-col gap-4">
          {logs.map((asset, idx) => {
            const isExpanded = expandedIndex === idx;
            return (
              <div
                key={asset.timestamp + "-" + idx}
                className="border border-white/5 bg-black/10 rounded-xl overflow-hidden"
              >
                <div
                  onClick={() => toggleExpand(idx)}
                  className="flex justify-between items-center p-4 cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono font-bold text-white">{asset.assetId}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(asset.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    {asset.approved ? (
                      asset.deployHash ? (
                        <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded uppercase font-bold">
                          Approved & Deployed
                        </span>
                      ) : (
                        <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded uppercase font-bold">
                          Approved but Reverted
                        </span>
                      )
                    ) : (
                      <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] px-2 py-0.5 rounded uppercase font-bold">
                        Rejected
                      </span>
                    )}

                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4 border-t border-white/5 bg-black/20 font-mono text-[11px] text-slate-400 space-y-2">
                    <div>
                      <span className="text-slate-500">Deploy Hash: </span>
                      <span className="text-slate-300">
                        {asset.deployHash ? (
                          <a
                            href={`https://testnet.cspr.live/deploy/${asset.deployHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            {asset.deployHash}
                          </a>
                        ) : (
                          "N/A (aborted)"
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Allocated Amount: </span>
                      <span className="text-slate-300">{asset.amountCspr} CSPR</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Risk Factor: </span>
                      <span className="text-slate-300">{(asset.riskIndex * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Block Placement: </span>
                      <span className="text-slate-300">{asset.deployHash ? "Confirmed" : "Failed / Compliance Check Refused"}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
