import { isPlaceholder } from "../../../site/company";

/** Prints a company detail. Unfilled [[placeholders]] are highlighted so they cannot be missed before launch. */
export function Fill({ value }: { value: string }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  return (
    <mark className="rounded bg-amber-400/20 px-1 text-amber-200" title="Placeholder: replace it in src/site/company.ts">
      {value}
    </mark>
  );
}
