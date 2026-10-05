# Payslip testnet demo run

- Run id: `284c2421-1fa8-4f33-8400-6a4e21ce73a7`
- Period: 2026-09-01 to 2026-09-30
- Venue: testnet-fixed-rate
- Funded: $32,501.76
- ZEC acquired: 0.02407538
- Fill rate: $1,349,999.875391 per ZEC
- Allocation transaction: [18cdbaf8e801ea07a1ebb7e3730973f0ae72caf95a67091761521b8bf0a6e0aa](https://testnet.zecblock.com/tx/18cdbaf8e801ea07a1ebb7e3730973f0ae72caf95a67091761521b8bf0a6e0aa) at height 4465681

| Contractor | USD | ZEC | Txid | Height |
| --- | ---: | ---: | --- | ---: |
| Amara Okafor | 4,800.00 | 0.00355556 | [76b71420ee4b72f0d5ef34ce6ba8c7dd33f0e876a38771a537dc1b54d5278685](https://testnet.zecblock.com/tx/76b71420ee4b72f0d5ef34ce6ba8c7dd33f0e876a38771a537dc1b54d5278685) | 4465683 |
| Mateo Fernandez | 6,250.00 | 0.00462963 | [2a4941e69c0c466b4dd5117f11b52c8205883514745c849f92c68ef2aa267991](https://testnet.zecblock.com/tx/2a4941e69c0c466b4dd5117f11b52c8205883514745c849f92c68ef2aa267991) | 4465683 |
| Priya Raman | 5,400.00 | 0.00400000 | [cb5d784deecb30776c5fae552ac352b82025bf3e6999358f7216929906e0bbf4](https://testnet.zecblock.com/tx/cb5d784deecb30776c5fae552ac352b82025bf3e6999358f7216929906e0bbf4) | 4465683 |
| Jonas Lindqvist | 7,100.00 | 0.00525926 | [0f9b8ec8e839334afd62ed50bcfb0247a825b7f6db1a1d911b210322229832e1](https://testnet.zecblock.com/tx/0f9b8ec8e839334afd62ed50bcfb0247a825b7f6db1a1d911b210322229832e1) | 4465684 |
| Mei Chen | 3,950.00 | 0.00292593 | [6a4ccfca0f250d4b8644b2fa526d2f71a3cd9b0b0a391b80da2f8a2e7316b0b6](https://testnet.zecblock.com/tx/6a4ccfca0f250d4b8644b2fa526d2f71a3cd9b0b0a391b80da2f8a2e7316b0b6) | 4465684 |
| Kwame Mensah | 2,875.50 | 0.00213000 | [6e247b18427613bd0ba27746d08dbf5f737548498c7a7ebe5e8e318440b4af00](https://testnet.zecblock.com/tx/6e247b18427613bd0ba27746d08dbf5f737548498c7a7ebe5e8e318440b4af00) | 4465684 |

## Accountant reconciliation of this run

From `POST /api/statements/accountant.csv` over every exported key of that wallet, 5 Oct 2026 (the landing page's reconciliation vignette uses these figures):

| Funded USD | ZEC acquired | Paid USD | Paid ZEC | Network fees ZEC | Unspent ZEC | Variance USD | Explained USD | Difference | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 32,501.76 | 0.02407538 | 30,375.50 | 0.02250038 | 0.00095000 | 0.00062500 | 2,126.26 | 2,126.25 | 0.01 (rounding; allowance 0.07) | reconciled |

Variance is funded minus paid. Explained is the ZEC acquired but not paid out (network fees plus unspent), valued at the run's fill rate. Each line's ZEC is rounded to the zatoshi, so the two may differ by up to one cent per line plus one.
