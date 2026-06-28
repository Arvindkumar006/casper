use odra::prelude::*;
use odra::casper_types::U256;

/// Event emitted when capital is successfully deployed to an RWA asset.
#[odra::event]
pub struct CapitalDeployed {
    pub asset_id: String,
    pub amount: U256,
    pub total_allocated: U256,
}

/// Event emitted when a new asset is registered in the portfolio.
#[odra::event]
pub struct AssetRegistered {
    pub asset_id: String,
    pub valuation: U256,
    pub risk_score: U256,
}

/// Custom error enumeration for the NexusVault contract.
#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
}

/// Record structure for portfolio asset tracking.
#[odra::odra_type]
pub struct AssetRecord {
    pub asset_id: String,
    pub valuation: U256,
    pub allocated_capital: U256,
    pub risk_score: U256,
    pub active: bool,
}

/// Smart contract module to manage capital allocations for Real World Assets (RWAs).
#[odra::module(events = [CapitalDeployed, AssetRegistered])]
pub struct NexusVault {
    agent_swarm_key: Var<Address>,
    allocated_capital: Mapping<String, U256>,
    total_allocations: Var<U256>,
    total_assets_count: Var<u32>,
    asset_records: Mapping<String, AssetRecord>,
}

#[odra::module]
impl NexusVault {
    /// Initializes the contract with the initial agent swarm key.
    pub fn init(&mut self, agent_swarm_key: Address) {
        self.agent_swarm_key.set(agent_swarm_key);
        self.total_allocations.set(U256::zero());
        self.total_assets_count.set(0);
    }

    /// Deploys capital to a specific RWA asset ID.
    /// Registers or updates the asset record within the portfolio.
    pub fn deploy_capital(&mut self, asset_id: String, amount: U256, valuation: U256, risk_score: U256) {
        let caller = self.env().caller();
        let agent_swarm_key = match self.agent_swarm_key.get() {
            Some(key) => key,
            None => self.env().revert(Error::Unauthorized),
        };

        if caller != agent_swarm_key {
            self.env().revert(Error::Unauthorized);
        }

        // 1. Update allocated capital map
        let current_capital = self.allocated_capital.get(&asset_id).unwrap_or_default();
        let new_capital = current_capital + amount;
        self.allocated_capital.set(&asset_id, new_capital);

        // 2. Update total portfolio allocations
        let current_total = self.total_allocations.get().unwrap_or_default();
        let new_total = current_total + amount;
        self.total_allocations.set(new_total);

        // 3. Update or create the AssetRecord
        let is_new = self.asset_records.get(&asset_id).is_none();
        let record = AssetRecord {
            asset_id: asset_id.clone(),
            valuation,
            allocated_capital: new_capital,
            risk_score,
            active: true,
        };
        self.asset_records.set(&asset_id, record);

        // 4. Update asset count if new
        if is_new {
            let count = self.total_assets_count.get().unwrap_or_default();
            self.total_assets_count.set(count + 1);
            self.env().emit_event(AssetRegistered {
                asset_id: asset_id.clone(),
                valuation,
                risk_score,
            });
        }

        // 5. Emit CapitalDeployed event
        self.env().emit_event(CapitalDeployed {
            asset_id,
            amount,
            total_allocated: new_total,
        });
    }

    /// Public getter for the current agent swarm key.
    pub fn agent_swarm_key(&self) -> Address {
        self.agent_swarm_key.get().unwrap_or_revert(self)
    }

    /// Public getter for capital allocated to a specific RWA asset.
    pub fn allocated_capital(&self, asset_id: String) -> U256 {
        self.allocated_capital.get(&asset_id).unwrap_or_default()
    }

    /// Public getter for total portfolio allocations.
    pub fn total_allocations(&self) -> U256 {
        self.total_allocations.get().unwrap_or_default()
    }

    /// Public getter for total assets count.
    pub fn total_assets_count(&self) -> u32 {
        self.total_assets_count.get().unwrap_or_default()
    }

    /// Public getter to retrieve an asset record.
    pub fn get_asset_record(&self, asset_id: String) -> Option<AssetRecord> {
        self.asset_records.get(&asset_id)
    }
}
