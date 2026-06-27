# Casper Agentic Buildathon 2026 - Developer Resources

This document outlines the official developer toolkits, Model Context Protocol (MCP) servers, micropayment protocols (x402), and documentation links released by the Casper Association for the **Casper Agentic Buildathon 2026**. Use these resources to empower AI agents to interact directly with the Casper Network.

---

## 1. Core AI & Agentic Developer Portals

*   **Casper AI Hub**: [casper.network/ai](https://www.casper.network/ai) - Portal introducing the AI Toolkit, developer guides, and integrations.
*   **Casper Developer Portal**: [docs.casper.network](https://docs.casper.network) - Comprehensive guides, contract structures, API schemas, and SDK references.
*   **Casper Developer Discord**: [discord.com/invite/caspernetwork](https://discord.com/invite/caspernetwork) - Official chat server for live developer support and Casper ecosystem collaboration.

---

## 2. Model Context Protocol (MCP) Servers for Casper

MCP is an open standard that allows LLMs and AI models to securely query, discover, and invoke blockchain utilities. The following servers can be integrated with your TypeScript agents or custom AI models:

| Repository Name | Description | Key Capabilities |
| :--- | :--- | :--- |
| [Tairon-ai/casper-network-mcp](https://github.com/Tairon-ai/casper-network-mcp) | General Casper Network MCP Server | Handles querying block info, transaction checks, and base network operations. |
| [make-software/cspr-trade-mcp](https://github.com/make-software/cspr-trade-mcp) | CSPR.trade DEX MCP Server | Empowers agents to execute token swaps, query price feeds, and manage liquidity pools on-chain. |
| [Blockchain-Oracle/cspr-ai](https://github.com/Blockchain-Oracle/cspr-ai) | Multi-Utility AI Agent Toolset | Incorporates 50+ tools for wallet setup, private key encryption, contract queries, and deployment. |
| [Haiven-MCP/haiven-mcp](https://github.com/Haiven-MCP/haiven-mcp) | Development Methodology MCP | Guides agent workflows, design patterns, and structure conventions for Casper AI development. |

---

## 3. x402 HTTP-Native Micropayments Protocol

The **x402** protocol enables machine-to-machine economies on Casper. AI agents can dynamically make micropayments for paid API payloads and web data access without human sign-off:

*   **HTTP 402 ("Payment Required") Flow**: 
    1. The AI Agent calls a paid data service.
    2. The endpoint responds with `402 Payment Required`, indicating the price in CSPR.
    3. The agent verifies the payment request, signs the CSPR transfer authorization on Casper, and re-submits the request.
    4. The data provider verifies the cryptographic proof of payment on-chain and resolves the request.
*   **Casper x402 Facilitator**: Production-ready on-chain gateway on the Casper Mainnet resolving microtransactions.
*   **Casper x402 Fuse**: Developer API gateway middleware. It wraps target APIs and enforces secure payment schemas, protecting AI agents from malicious depletion loops.

---

## 4. Wallet & Signing Integrations

*   **CSPR.click AI Agent Skill**: Incorporates secure wallet generation, cryptographic keys storage, and remote/local transaction signing.
*   **Casper Event Streaming (SSE)**: Official Casper node event stream endpoint: `https://node.testnet.casper.network/events` (used in our `/agents` project). Use it to listen for `DeployProcessed` and custom smart contract events (like `CapitalDeployed`).
