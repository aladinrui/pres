/** Noms connus pour le tenant pres — fallback quand le JWT ne fournit pas de name.
 *  Pour tod, les noms (ex: "2.1") viennent toujours du JWT. */
const KNOWN_BUREAU_NAMES: Record<number, string> = {
  3: 'CRN', 4: 'STV', 5: 'MRO', 6: 'SRG',
  7: 'YN',  8: 'JC',  9: 'PAST', 10: 'PASC',
}

/** Construit la map id→name depuis les bureaux du token JWT.
 *  Priorité : nom du JWT → KNOWN_BUREAU_NAMES → undefined */
export function buildBureauNameMap(
  tokenBureaux: Array<{ id?: number; name?: string }> | null | undefined
): Record<number, string> {
  const fromToken: Record<number, string> = Object.fromEntries(
    (tokenBureaux ?? [])
      .filter((b) => b?.id && b?.name)
      .map((b) => [Number(b.id), String(b.name)])
  )
  return { ...fromToken, ...KNOWN_BUREAU_NAMES }
}
