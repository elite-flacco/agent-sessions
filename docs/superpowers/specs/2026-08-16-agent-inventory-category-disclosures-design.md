# Agent Inventory Category Disclosures

## Goal

Allow each source category in the Agent Setup Inventory view to be expanded or collapsed independently.

## Behavior

- Every rendered source category starts expanded.
- Selecting the category heading toggles only that category's capability rows.
- The category title, description, icon, and item count remain visible while collapsed.
- Plugin skill groups remain independently expandable inside the Plugin-provided category.
- Changing provider, kind, or search filters renders the available categories expanded again.
- Compare, Scheduled, capability selection, and the inspector remain unchanged.

## Implementation

Use the browser's native disclosure element for each existing `CatalogSourceGroup`. The current category heading becomes its summary and the current category body becomes its collapsible content. Add only the CSS needed for the disclosure marker, hover, focus, and open state, reusing Relay's existing semantic tokens.

## Accessibility

The native disclosure control provides keyboard activation and expanded/collapsed semantics. The visible category heading remains the control label, and focus uses the existing global focus treatment.

## Verification

- Add focused component coverage showing that every source category renders as an open disclosure and retains its item count and rows.
- Confirm nested plugin disclosures still render within their source category.
- Run the focused Agent Setup tests and the full `npm run verify` suite.
- Exercise category toggling on the Agent Setup Inventory page at desktop and mobile widths and check the browser console.
