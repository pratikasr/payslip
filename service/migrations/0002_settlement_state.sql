-- Contractor settlement (ADR-018): the conversion quote and its outcome for a convert_usdc line.
ALTER TABLE pay_lines ADD COLUMN settlement_state TEXT;
