use odra::prelude::*;
use odra::casper_types::U256;

/// Event emitted when capital is successfully deployed to an RWA asset.
#[odra::event]
pub struct CapitalDeployed {
    pub asset_id: String,
    pub amount: U256,
}

/// Custom error enumeration for the NexusVault contract.
#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
}

/// Smart contract module to manage capital allocations for Real World Assets (RWAs).
#[odra::module(events = [CapitalDeployed])]
pub struct NexusVault {
    agent_swarm_key: Var<Address>,
    allocated_capital: Mapping<String, U256>,
}

#[odra::module]
impl NexusVault {
    /// Initializes the contract with the initial agent swarm key.
    pub fn init(&mut self, agent_swarm_key: Address) {
        self.agent_swarm_key.set(agent_swarm_key);
    }

    /// Deploys capital to a specific RWA asset ID.
    /// Emits a `CapitalDeployed` event upon success.
    /// Reverts with `Error::Unauthorized` if called by an address other than the agent swarm key.
    pub fn deploy_capital(&mut self, asset_id: String, amount: U256) {
        let caller = self.env().caller();
        let agent_swarm_key = match self.agent_swarm_key.get() {
            Some(key) => key,
            None => self.env().revert(Error::Unauthorized),
        };

        if caller != agent_swarm_key {
            self.env().revert(Error::Unauthorized);
        }

        let current_capital = self.allocated_capital.get(&asset_id).unwrap_or_default();
        let new_capital = current_capital + amount;
        self.allocated_capital.set(&asset_id, new_capital);

        self.env().emit_event(CapitalDeployed {
            asset_id,
            amount,
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
}
