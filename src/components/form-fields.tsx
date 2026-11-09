// Plain form controls (no client state), usable from server components.
import { FieldError } from "./forms";

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

export function Field({
  label,
  name,
  hint,
  children,
  className = "",
}: {
  label: string;
  name: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  return <input id={props.name} {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  return <textarea id={props.name} rows={3} {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export type Option = { value: string; label: string };

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { name: string; options: Option[]; placeholder?: string }) {
  return (
    <select id={props.name} {...props} className={`${inputClass} ${props.className ?? ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300" />
      {label}
    </label>
  );
}

/** Responsive grid for form fields. */
export function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={`grid gap-4 ${c}`}>{children}</div>;
}
