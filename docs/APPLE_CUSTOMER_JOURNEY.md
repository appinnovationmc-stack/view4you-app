# CheckVertical — Premium UX and Customer Journey Standard

## Product promise
Help people make better-informed vehicle decisions, commission trustworthy inspections, and retain the evidence. Missing records must never imply a vehicle is clear; estimates must never be presented as verified facts.

## Primary customer journey
1. **Discover:** explain the service plainly; provide one primary action to search by registration/VIN or book an inspection.
2. **Identify:** resolve vehicle identity, disclose the source/status of material fields, and allow correction before checkout.
3. **Understand coverage:** distinguish existing history records from a new physical inspection; show limitations before payment.
4. **Choose service:** compare active tiers by checks, deliverables and timing; show only real availability.
5. **Set location and appointment:** validate the address, itemize travel charges, and show only backend-confirmed appointment options.
6. **Review checkout:** itemize tier, report add-on, travel and fees; show final ZAR total and terms before payment.
7. **Track booking:** show pending/confirmed/needs-action states; never claim assignment or arrival without backend confirmation.
8. **Inspect:** guide checklist, photos and measurements; support recovery and prevent submission when required evidence is missing.
9. **Review report:** plain-language summary first; critical findings before minor observations; connect findings to photos/readings and explain limitations.
10. **Save and share:** keep owned reports, bookings, documents and vehicles in My Garage; enforce authenticated access.
11. **Return and resolve:** support, booking changes, receipts, corrections and account/data controls with clear status feedback.

## Supporting role journeys
- **Inspector:** onboarding/credential review → availability → accept/decline job → navigation → checklist/evidence → submit → earnings/payout status.
- **Dealer/auction:** business verification → listing management → vehicle identity → report linkage → enquiries/bookings → moderation.
- **Administrator:** role-protected sign-in → real operational dashboard → inspector/station review → booking/report/support/payment management → audited sensitive actions.
- **Testing station:** list only real active, correctly located, bookable stations. Empty inventory must produce an honest unavailable state.
- **Payment:** server-authoritative pricing; verified provider callbacks; idempotent events; reconciliation; a client redirect is not proof of payment.

## Visual design principles
- Quiet confidence, not a generic AI dashboard: strong typography, whitespace, meaningful grouping and real automotive evidence.
- Palette: obsidian #0B0D10, graphite #171B21, porcelain #F4F5F6, signal mint #47D7AC. Preserve semantic status colors.
- Use dark surfaces selectively for high-impact vehicle moments; light high-contrast surfaces for long reports and dense admin tables.
- One primary action per screen. Secondary actions remain quieter. Avoid decorative effects that compete with evidence.
- Every workflow needs relevant loading, empty, error, disabled, success and permission-denied states.
- Mobile-first responsive layouts, keyboard access, visible focus, reduced-motion support, large touch targets and accessible labels.

## Acceptance checklist
- A first-time customer can search, understand history versus inspection, see the complete price, book/pay, track progress, open a report and find it later.
- Every visible control works; no dead buttons or misleading demo values.
- Test real customer, inspector, dealer and admin roles and permissions.
- Vehicle facts, prices, appointment slots, inspector status, station data and payment outcomes come from trusted backend responses.
- Report permissions prevent unauthorized access; payment events are verified and idempotent.
- Test small/large phones, tablet, desktop, keyboard navigation, reduced motion, slow network, interrupted uploads and expired sessions.
- Automated tests, typecheck, customer/admin/fleet builds, database checks and production smoke tests pass before release sign-off.

## Delivery sequence
1. Inventory every route and role; capture baseline screenshots.
2. Establish design tokens and shared components without breaking workflows.
3. Redesign search, vehicle identity and report reading.
4. Redesign booking, checkout and booking status.
5. Refine inspector, garage, dealer/auction and support journeys.
6. Align admin console with operational workflows.
7. Run automated tests and real-account end-to-end checks; resolve security, payment and station blockers.
8. Deploy, smoke-test production and record verified commit/deployment IDs.

## Integrity rules
Never invent inspection findings, prices, report availability, station inventory, appointment slots, ETA, payment success or verification badges. If a source is unavailable, explain the limitation and offer the next valid action.
