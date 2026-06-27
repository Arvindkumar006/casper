#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod nexus_vault;

pub use nexus_vault::NexusVault;
