# Demo walkthrough

Start `python3 -m aerol` and open http://127.0.0.1:8000/. Optional: open http://127.0.0.1:8000/dashboard/
in a second window — both follow the same clock.

| # | Step | What to show | What to say |
|---|---|---|---|
| 1 | Watch status | Home: FD18, recovery ring, “No active alerts”, chips for phase and region | The watch is the product. Phase and exposure region are separate concepts. |
| 2 | Mission progression | Transport plays at 12 h/s; watch, charts, link status move together | One shared clock; auto-pause on new alerts. |
| 3 | Exposure change | Radiation screen at the belt transit / magnetosphere exit | Explicit trajectory event; dose rate steps 0.7 → 1.84 mSv/day. Biology does not jump at the boundary. |
| 4 | Actionable alert | Advisory “Dose rate rose sharply”: reading, rule, origin, one next action | Demo thresholds, simulated dosimeter, acknowledgment ≠ resolution. |
| 5 | Health-check workflow | Caution “Sustained resting heart-rate rise” during the simulated outage → Acknowledge → Record symptoms → Begin follow-up → Contact crew medical support | Onboard support is the immediate route; Earth is delayed; packets queue. |
| 6 | Earth research review | Review queue after the outage: evidence packets, physician message back, research review for TERRA projection, editable check-up brief | Research items never trigger treatment; messages are simulated. |
| 7 | Landing & recovery | Follow-up screen at R+1.3; Earth timeline: dose plateau, R+0 WBC result, TERRA relaxing toward 1.0× | Cumulative dose never falls; in-flight TERRA samples are assayed on Earth after return. |

Extras worth showing on the dashboard: compare scenarios (“stays inside magnetosphere”), move
the TERRA lag/sensitivity sliders, select an interval and export the annotated report, click any
marker for its seven-question explanation, switch to **Observed research** (Twins TERRA + DosTel;
Inspiration4 CBC), and the **Phase comparison** table. Use the scenario menu → “Default + assumed
solar particle event” for an Urgent alert.
