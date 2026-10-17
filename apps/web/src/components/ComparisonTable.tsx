import type { ReactNode } from "react";
import { useId } from "react";

export interface ComparisonRow {
  label: string;
  values: [string, string, string];
}

// ui-direction.md §4: three categories, seven rows, a real <table> with a
// <caption> and scope attributes. The argument is typographic (the
// highlighted column is larger/darker, never colour alone — A11), and the
// same markup reflows to cards at 640px via blocks.css, using a real
// `.cell-label` span rather than generated ::before content (§4.2).
export function ComparisonTable({
  caption,
  cornerLabel,
  columns,
  rows,
  highlightIndex = 2,
  footnote,
}: {
  caption: string;
  cornerLabel: string;
  columns: [string, string, string];
  rows: ComparisonRow[];
  highlightIndex?: 0 | 1 | 2;
  footnote?: ReactNode;
}) {
  const captionId = useId();
  return (
    <>
      <div
        className="comparison-table__region"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table className="comparison-table">
          <caption id={captionId} className="visually-hidden">
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col">{cornerLabel}</th>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={
                    index === highlightIndex
                      ? "comparison-table__cell--highlight"
                      : undefined
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => (
                  <td
                    key={columns[index]}
                    className={
                      index === highlightIndex
                        ? "comparison-table__cell--highlight"
                        : undefined
                    }
                  >
                    <span className="cell-label">{columns[index]}</span>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote ? (
        <p className="comparison-table__footnote">{footnote}</p>
      ) : null}
    </>
  );
}
