import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadAssets, createAsset, upsertAsset, findAsset, NexusAsset } from '../src/asset_registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wallet-Address');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Wallet header — required for write operations
  const walletAddress = (req.headers['x-wallet-address'] as string) || '';

  // ── GET /api/assets ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const assets = loadAssets();
      return res.status(200).json({ success: true, data: assets });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── POST /api/assets — Create a new Draft asset ──────────────────────────
  if (req.method === 'POST') {
    if (!walletAddress) {
      return res.status(403).json({ success: false, error: 'X-Wallet-Address header is required' });
    }

    try {
      const body = req.body || {};
      const {
        assetId,
        assetName,
        assetType,
        valuation,
        downPayment,
        countryCode,
        borrowerCreditScore,
        currentInterestRate
      } = body;

      // Validate required fields
      if (!assetName || !valuation || !countryCode || !borrowerCreditScore) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: assetName, valuation, countryCode, borrowerCreditScore'
        });
      }

      const slugId = assetId
        || assetName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40)
          + '_' + Date.now().toString(36);

      const asset = createAsset({
        assetId: slugId,
        assetName,
        assetType: assetType || 'RealEstate',
        valuation: Number(valuation),
        downPayment: Number(downPayment) || Math.floor(Number(valuation) * 0.20),
        countryCode,
        borrowerCreditScore: Number(borrowerCreditScore),
        currentInterestRate: Number(currentInterestRate) || 0.065,
        ownerAddress: walletAddress
      });

      return res.status(201).json({ success: true, data: asset });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── PATCH /api/assets — Update asset status/fields ───────────────────────
  if (req.method === 'PATCH') {
    try {
      const { assetId, ...updates } = req.body || {};
      if (!assetId) {
        return res.status(400).json({ success: false, error: 'assetId is required' });
      }
      const asset = upsertAsset(assetId, updates);
      return res.status(200).json({ success: true, data: asset });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
