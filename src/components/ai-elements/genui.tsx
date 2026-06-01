'use client';

/**
 * genui.tsx — SPIKE: real-time generative UI via json-render (@json-render/*).
 *
 * The LLM emits a flat json-render spec ({ root, elements: { id: {type,props,children}} })
 * constrained to the catalog below; the renderer maps each catalog component to a
 * real Bühler shadcn component. Declarative data only — no model-authored code runs
 * (catalog-guarded), and the host owns all styling/theming.
 *
 * Wiring: rendered from rich-response.tsx whenever the assistant emits a ```genui
 * fenced block. The catalog's auto-generated system prompt (genuiSystemPrompt()) is
 * what you'd inject server-side to make the model emit valid specs.
 */
import * as React from 'react';
import { defineCatalog } from '@json-render/core';
import { createRenderer } from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/features/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/features/ui/table';
import { Badge } from '@/features/ui/badge';
import { cn } from '@/features/ui/lib';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

/**
 * Measures an element's width via ResizeObserver, guarded so it only updates
 * on an actual change. Used instead of recharts' ResponsiveContainer, whose
 * percentage-measure loop trips "Maximum update depth exceeded" in React 19
 * (it reports width/height -1 and re-renders endlessly inside a chat card).
 */
function useContainerWidth() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setWidth((prev) => (prev !== w ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------------------------------------------------------------------------
// Catalog — the only components the model is allowed to compose.
// ---------------------------------------------------------------------------
export const genuiCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      description: 'Flex container that lays out its children vertically (col) or horizontally (row).',
      props: z.object({
        direction: z.enum(['col', 'row']).optional().describe('Layout direction, default col'),
      }),
    },
    Card: {
      description: 'A titled card container. Put Stat / Table / Text children inside it.',
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    Stat: {
      description: 'A single KPI tile: a small label, a large value, and an optional delta with trend arrow.',
      props: z.object({
        label: z.string(),
        value: z.string(),
        delta: z.string().optional(),
        trend: z.enum(['up', 'down', 'flat']).optional(),
      }),
    },
    Badge: {
      description: 'A small status pill.',
      props: z.object({
        label: z.string(),
        tone: z.enum(['default', 'success', 'warning', 'destructive']).optional(),
      }),
    },
    Table: {
      description: 'A data table. columns = header strings; rows = list of rows, each row a list of cell strings aligned to columns.',
      props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
    },
    Text: {
      description: 'A short paragraph of text.',
      props: z.object({
        content: z.string(),
        muted: z.boolean().optional(),
      }),
    },
    Chart: {
      description: 'A line or bar chart. data is a list of points, each { label, value }.',
      props: z.object({
        kind: z.enum(['line', 'bar']).optional(),
        title: z.string().optional(),
        data: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
    },
  },
  // json-render's defineCatalog types `props` as a branded SchemaType<"zod">,
  // not a raw z.object() — its public docs pass z.object() directly, so the
  // type is stricter than the supported usage. Components render untyped (see
  // readProps), so loosen the catalog input type. (Unrelated to the zod version.)
} as any);

// ---------------------------------------------------------------------------
// Registry — maps each catalog component to a real Bühler shadcn component.
// json-render passes ComponentRenderProps; read props defensively so we work
// whether the runtime hands us { props } or { element: { props } }.
// ---------------------------------------------------------------------------
type AnyProps = Record<string, unknown>;
const readProps = (a: { props?: AnyProps; element?: { props?: AnyProps } }): AnyProps =>
  a.props ?? a.element?.props ?? {};

const toneToVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  default: 'default',
  success: 'default',
  warning: 'secondary',
  destructive: 'destructive',
};

const genuiComponents = {
    Stack: (a: any) => {
      const p = readProps(a);
      return (
        <div className={cn('flex gap-3', p.direction === 'row' ? 'flex-row flex-wrap' : 'flex-col')}>
          {a.children}
        </div>
      );
    },
    Card: (a: any) => {
      const p = readProps(a);
      return (
        <Card>
          {(!!p.title || !!p.description) && (
            <CardHeader>
              {!!p.title && <CardTitle className="text-base">{String(p.title)}</CardTitle>}
              {!!p.description && <CardDescription>{String(p.description)}</CardDescription>}
            </CardHeader>
          )}
          <CardContent className="space-y-3">{a.children}</CardContent>
        </Card>
      );
    },
    Stat: (a: any) => {
      const p = readProps(a);
      const Trend = p.trend === 'up' ? TrendingUp : p.trend === 'down' ? TrendingDown : Minus;
      const color =
        p.trend === 'up' ? 'text-green-600' : p.trend === 'down' ? 'text-red-600' : 'text-muted-foreground';
      return (
        <div className="flex flex-col gap-1 min-w-[8rem]">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{String(p.label ?? '')}</span>
          <span className="text-2xl font-semibold">{String(p.value ?? '')}</span>
          {p.delta != null && (
            <span className={cn('flex items-center gap-1 text-xs', color)}>
              <Trend className="size-3.5" />
              {String(p.delta)}
            </span>
          )}
        </div>
      );
    },
    Badge: (a: any) => {
      const p = readProps(a);
      return <Badge variant={toneToVariant[String(p.tone ?? 'default')] ?? 'default'}>{String(p.label ?? '')}</Badge>;
    },
    Table: (a: any) => {
      const p = readProps(a);
      const columns = Array.isArray(p.columns) ? (p.columns as string[]) : [];
      const rows = Array.isArray(p.rows) ? (p.rows as string[][]) : [];
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead key={i}>{String(c)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow key={ri}>
                {(Array.isArray(row) ? row : [row]).map((cell, ci) => (
                  <TableCell key={ci}>{String(cell)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    },
    Text: (a: any) => {
      const p = readProps(a);
      return <p className={cn('text-sm', !!p.muted && 'text-muted-foreground')}>{String(p.content ?? '')}</p>;
    },
    Chart: (a: any) => {
      const p = readProps(a);
      const data = Array.isArray(p.data) ? (p.data as Array<{ label: string; value: number }>) : [];
      const isBar = p.kind === 'bar';
      const [ref, width] = useContainerWidth();
      const height = 220;
      return (
        <div className="flex flex-col gap-2">
          {!!p.title && <span className="text-sm font-medium">{String(p.title)}</span>}
          <div ref={ref} className="w-full" style={{ height }}>
            {width > 0 &&
              (isBar ? (
                <BarChart width={width} height={height} data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart width={width} height={height} data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              ))}
          </div>
        </div>
      );
    },
};

// Self-contained renderer (bundles the Visibility/State/Action providers the
// low-level <Renderer> requires). Maps catalog components → Bühler shadcn.
const GenuiRenderer = createRenderer(genuiCatalog, genuiComponents as any);

// ---------------------------------------------------------------------------
// Render wrapper — parses the streamed JSON and renders it, with an error
// boundary so a malformed/partial spec never takes down the chat message.
// ---------------------------------------------------------------------------
class GenUIBoundary extends React.Component<
  { children: React.ReactNode; raw: string },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return (
        <pre className="overflow-x-auto rounded bg-muted/40 p-2 text-xs text-muted-foreground">
          {this.props.raw}
        </pre>
      );
    }
    return this.props.children;
  }
}

export function GenUI({ json }: { json: string }) {
  const spec = React.useMemo(() => {
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }, [json]);

  // Not valid JSON / not a spec yet → show raw text. GenUI only mounts for a
  // completed turn (RichResponse gates it off while streaming), and
  // GenUIBoundary catches any error from a malformed spec, so no extra
  // completeness pre-check is needed here.
  if (!spec || typeof spec !== 'object' || !('root' in spec) || !('elements' in spec)) {
    return (
      <pre className="overflow-x-auto rounded bg-muted/40 p-2 text-xs text-muted-foreground">{json}</pre>
    );
  }

  return (
    <GenUIBoundary raw={json}>
      <div className="my-2 rounded-lg border border-border/60 bg-background p-3">
        <GenuiRenderer spec={spec as never} />
      </div>
    </GenUIBoundary>
  );
}

