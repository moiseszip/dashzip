/** ROI de seleção agregada. Imposto sobre venda e IOF têm bases distintas. */
export function dashboardRoi(
  net: number | null, salesTax: number | null, spend: number | null, iof: number | null,
): number | null {
  if (net === null || salesTax === null || spend === null || iof === null) return null;
  const mediaCost = spend + iof;
  return mediaCost === 0 ? null : (net - salesTax) / mediaCost;
}
