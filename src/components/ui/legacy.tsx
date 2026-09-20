"use client";

import type * as React from "react";
import type { ButtonHTMLAttributes, ComponentType, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from "react";
import { Children, cloneElement, createContext, isValidElement, useContext, useId, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button as UiButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type TagTone = "blue" | "cyan" | "teal" | "green" | "purple" | "magenta" | "red" | "gray" | "warm-gray" | "outline";
const toneClass: Record<TagTone, string> = {
  blue: "border-primary/20 bg-primary/[0.065] text-primary", cyan: "border-teal-200 bg-teal-50 text-teal-900", teal: "border-teal-200 bg-teal-50 text-teal-900", green: "border-emerald-200 bg-emerald-50 text-emerald-800", purple: "border-violet-200 bg-violet-50 text-violet-800", magenta: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800", red: "border-red-200 bg-red-50 text-red-800", gray: "border-stone-200 bg-stone-50 text-stone-700", "warm-gray": "border-stone-200 bg-stone-50 text-stone-800", outline: "border-border bg-card text-foreground",
};

export function Tag({ type = "gray", children, className }: { type?: TagTone; size?: "sm"; children: ReactNode; className?: string }) {
  return <Badge variant="outline" className={cn(toneClass[type], className)}>{children}</Badge>;
}

export function InlineNotification({ kind, title, subtitle, hideCloseButton, onCloseButtonClick }: { kind: "success" | "error" | "warning" | "info"; title: string; subtitle?: string; lowContrast?: boolean; hideCloseButton?: boolean; onCloseButtonClick?: () => void }) {
  const style = kind === "error" ? "border-red-200 bg-red-50 text-red-900" : kind === "warning" ? "border-amber-200 bg-amber-50 text-amber-950" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-primary/20 bg-primary/[0.065] text-primary";
  return <div role={kind === "error" ? "alert" : "status"} className={cn("my-3 flex items-start gap-3 rounded-lg border p-3 text-sm", style)}><div className="flex-1"><strong>{title}</strong>{subtitle && <p className="mt-1 leading-5">{subtitle}</p>}</div>{!hideCloseButton && <button type="button" className="grid size-8 cursor-pointer place-items-center rounded-md hover:bg-black/5" aria-label="关闭通知" onClick={onCloseButtonClick}><X className="size-4" aria-hidden="true" /></button>}</div>;
}

type LegacyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger--tertiary";
  size?: "sm" | "md";
  renderIcon?: ComponentType<{ className?: string; size?: number; "aria-hidden"?: boolean }>;
  hasIconOnly?: boolean;
  iconDescription?: string;
  as?: "a";
  href?: string;
  target?: string;
  rel?: string;
};

export function Button({ kind = "primary", size, renderIcon: Icon, hasIconOnly, iconDescription, as, href, target, rel, children, className, ...props }: LegacyButtonProps) {
  const variant: "default" | "outline" | "ghost" | "destructive" = kind === "secondary" || kind === "tertiary" ? "outline" : kind === "ghost" ? "ghost" : kind === "danger--tertiary" ? "destructive" : "default";
  const content = <>{Icon && <Icon className="size-4" aria-hidden={true} />}{!hasIconOnly && children}{hasIconOnly && <span className="sr-only">{iconDescription}</span>}</>;
  const shared = { variant, size: hasIconOnly ? "icon" as const : size === "sm" ? "sm" as const : "default" as const, className };
  if (as === "a") return <UiButton {...shared} render={<a href={href} target={target} rel={rel} />}>{content}</UiButton>;
  return <UiButton {...shared} aria-label={hasIconOnly ? iconDescription : props["aria-label"]} {...props}>{content}</UiButton>;
}

export function TextInput({ id, labelText, className, size: _size, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { labelText: ReactNode; size?: "sm" }) {
  void _size;
  return <label className="grid gap-1 text-sm font-medium" htmlFor={id}>{labelText}<input id={id} className={cn("h-11 rounded-lg border bg-white px-3 font-normal disabled:opacity-50", className)} {...props} /></label>;
}

export function TextArea({ id, labelText, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { labelText: ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium" htmlFor={id}>{labelText}<textarea id={id} className={cn("min-h-20 rounded-lg border bg-white p-3 font-normal disabled:opacity-50", className)} {...props} /></label>;
}

export function Select({ id, labelText, children, className, size: _size, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { labelText: ReactNode; size?: "sm" }) {
  void _size;
  return <label className="grid gap-1 text-sm font-medium" htmlFor={id}>{labelText}<select id={id} className={cn("h-11 rounded-lg border bg-white px-3 font-normal disabled:opacity-50", className)} {...props}>{children}</select></label>;
}

export function SelectItem({ value, text }: { value: string; text: string }) { return <option value={value}>{text}</option>; }

export function Checkbox({ id, labelText, checked, onChange, disabled }: { id: string; labelText: ReactNode; checked: boolean; disabled?: boolean; onChange?: (event: React.ChangeEvent<HTMLInputElement>, data: { checked: boolean }) => void }) {
  return <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange?.(event, { checked: event.target.checked })} className="size-4 accent-primary" />{labelText}</label>;
}

export function Modal({ open, modalHeading, primaryButtonText, secondaryButtonText, primaryButtonDisabled, onRequestClose, onRequestSubmit, children }: { open: boolean; modalHeading: string; primaryButtonText: string; secondaryButtonText: string; primaryButtonDisabled?: boolean; onRequestClose: () => void; onRequestSubmit: () => void | Promise<void>; children: ReactNode }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onRequestClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{modalHeading}</DialogTitle></DialogHeader><div className="grid gap-4">{children}</div><DialogFooter><UiButton variant="outline" onClick={onRequestClose}>{secondaryButtonText}</UiButton><UiButton disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</UiButton></DialogFooter></DialogContent></Dialog>;
}

const TabsContext = createContext<{ active: number; setActive: (value: number) => void; baseId: string }>({ active: 0, setActive: () => undefined, baseId: "tabs" });
export function Tabs({ children, defaultIndex = 0 }: { children: ReactNode; defaultIndex?: number }) { const [active, setActive] = useState(defaultIndex); const baseId = useId(); return <TabsContext.Provider value={{ active, setActive, baseId }}><div>{children}</div></TabsContext.Provider>; }
export function TabList({ children, ...props }: { children: ReactNode; "aria-label"?: string; contained?: boolean; fullWidth?: boolean }) { return <div role="tablist" aria-label={props["aria-label"]} className="flex overflow-x-auto border-b">{Children.map(children, (child, index) => isValidElement(child) ? cloneElement(child as ReactElement<{ legacyIndex?: number }>, { legacyIndex: index }) : child)}</div>; }
export function Tab({ children, legacyIndex = 0 }: { children: ReactNode; legacyIndex?: number }) { const context = useContext(TabsContext); return <button type="button" role="tab" id={`${context.baseId}-tab-${legacyIndex}`} aria-controls={`${context.baseId}-panel-${legacyIndex}`} aria-selected={context.active === legacyIndex} tabIndex={context.active === legacyIndex ? 0 : -1} onClick={() => context.setActive(legacyIndex)} onKeyDown={(event) => { const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []); const current = tabs.indexOf(event.currentTarget); const target = event.key === "ArrowRight" ? tabs[(current + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(current - 1 + tabs.length) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined; if (target) { event.preventDefault(); target.focus(); target.click(); } }} className={cn("min-h-11 shrink-0 cursor-pointer border-b-2 px-4 text-sm font-medium", context.active === legacyIndex ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{children}</button>; }
export function TabPanels({ children }: { children: ReactNode }) { return <>{Children.map(children, (child, index) => isValidElement(child) ? cloneElement(child as ReactElement<{ legacyIndex?: number }>, { legacyIndex: index }) : child)}</>; }
export function TabPanel({ children, legacyIndex = 0 }: { children: ReactNode; legacyIndex?: number }) { const context = useContext(TabsContext); return context.active === legacyIndex ? <div role="tabpanel" id={`${context.baseId}-panel-${legacyIndex}`} aria-labelledby={`${context.baseId}-tab-${legacyIndex}`} className="py-4">{children}</div> : null; }

export function Accordion({ children }: { children: ReactNode }) { return <div className="divide-y rounded-lg border">{children}</div>; }
export function AccordionItem({ title, children }: { title: ReactNode; children: ReactNode }) { return <details className="group"><summary className="min-h-11 cursor-pointer list-none p-3 text-sm font-medium">{title}</summary><div className="px-3 pb-3 text-sm text-muted-foreground">{children}</div></details>; }

type DataRow = { id: string; [key: string]: unknown };
type Header = { key: string; header: string };
type PreparedRow = DataRow & { cells: Array<{ id: string; value: unknown; info: { header: string } }> };
export function DataTable<T extends DataRow>({ rows, headers, children }: { rows: T[]; headers: Header[]; children: (input: { rows: PreparedRow[]; headers: Header[]; getHeaderProps: (input: { header: Header }) => { key: string }; getRowProps: (input: { row: PreparedRow }) => { key: string }; getTableProps: () => Record<string, never> }) => ReactNode }) {
  const prepared = rows.map((row) => ({ ...row, cells: headers.map((header) => ({ id: `${row.id}:${header.key}`, value: row[header.key], info: { header: header.key } })) }));
  return <>{children({ rows: prepared, headers, getHeaderProps: ({ header }) => ({ key: header.key }), getRowProps: ({ row }) => ({ key: row.id }), getTableProps: () => ({}) })}</>;
}
export function TableContainer({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <section className="overflow-x-auto rounded-xl border bg-white"><div className="border-b p-4"><h3 className="font-semibold">{title}</h3>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{children}</section>; }
export function Table(props: React.TableHTMLAttributes<HTMLTableElement>) { return <table {...props} className={cn("w-full min-w-[720px] text-left text-sm", props.className)} />; }
export function TableHead(props: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead {...props} className={cn("border-b bg-muted/60 text-xs text-muted-foreground", props.className)} />; }
export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} />; }
export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) { return <tr {...props} className={cn("border-b last:border-0", props.className)} />; }
export function TableHeader(props: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th {...props} className={cn("p-3 font-medium", props.className)} />; }
export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td {...props} className={cn("p-3 align-top", props.className)} />; }
