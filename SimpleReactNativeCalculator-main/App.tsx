/**
 * React Native Calculator (hooks + modern RN patterns)
 * - Clean, responsive UI (adapts with useWindowDimensions)
 * - Basic ops: + - × ÷
 * - Advanced ops: % (postfix), √ (unary), ^ (power)
 * - Live expression + calculated result
 * - No eval(): shunting-yard parser + RPN evaluator
 * - Functional Components + Hooks only
 */

import * as React from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** ---------- Helpers & Types ---------- */

type Assoc = 'L' | 'R';

type OpInfo = {
  prec: number;     // precedence
  assoc: Assoc;     // associativity
  unary?: boolean;  // unary operator (e.g., √)
  func?: (a: number, b?: number) => number; // implementation
};

/**
 * Operator table:
 * - '^' right-associative power
 * - '√' unary square root
 * - '%' postfix percentage (handled as unary that divides by 100)
 * - '×', '÷', '+', '-'
 */
const OPS: Record<string, OpInfo> = {
  '^': { prec: 4, assoc: 'R', func: (a, b) => Math.pow(a, b ?? 1) },
  '√': { prec: 5, assoc: 'R', unary: true, func: a => Math.sqrt(a) },
  '%': { prec: 5, assoc: 'L', unary: true, func: a => a / 100 },
  '×': { prec: 3, assoc: 'L', func: (a, b) => (a ?? 0) * (b ?? 0) },
  '÷': { prec: 3, assoc: 'L', func: (a, b) => {
    if ((b ?? 0) === 0) return NaN;
    return (a ?? 0) / (b ?? 1);
  }},
  '+': { prec: 2, assoc: 'L', func: (a, b) => (a ?? 0) + (b ?? 0) },
  '-': { prec: 2, assoc: 'L', func: (a, b) => (a ?? 0) - (b ?? 0) },
};

const DIGITS = ['7','8','9','4','5','6','1','2','3','0','.'] as const;
const BASIC = ['+', '-', '×', '÷'] as const;
const ADV   = ['^', '√', '%', '(', ')'] as const;

/** ---------- Tokenization ---------- */
/**
 * Tokenizes an input string into numbers, operators, and parentheses.
 * Supports:
 *  - numbers (integers/decimals)
 *  - ops: + - × ÷ ^ % √
 *  - parentheses ( and )
 *  - implicit unary minus handled later by pre-processing
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ') { i++; continue; }
    if ('()+-×÷^%√'.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    // number: digits + optional single decimal
    if (/\d|\./.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[\d.]/.test(expr[j])) j++;
      tokens.push(expr.slice(i, j));
      i = j;
      continue;
    }
    // unknown char -> make it invalid token
    tokens.push(ch);
    i++;
  }
  return tokens;
}

/** ---------- Preprocess for unary minus ---------- */
/**
 * Convert unary '-' into '0 - ...' to simplify parsing.
 * E.g., "-3+2" -> "0","-","3","+","2"
 * Also handles "(-3)" after '(' or other operators.
 */
function normalizeUnaryMinus(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      t === '-' &&
      (i === 0 || ['(', '+', '-', '×', '÷', '^', '√'].includes(tokens[i - 1]))
    ) {
      out.push('0'); // inject zero for unary minus
      out.push('-');
    } else {
      out.push(t);
    }
  }
  return out;
}

/** ---------- Shunting-yard (to RPN) ---------- */
function toRPN(tokens: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // number
    if (!isNaN(Number(t))) {
      out.push(t);
      continue;
    }

    // functions/unary prefix (√) or operators
    if (t in OPS) {
      const thisOp = OPS[t];

      // Postfix '%' should be applied immediately to previous value:
      if (t === '%') {
        // treat as operator: pop/compare with stack precedence as unary
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (!(top in OPS)) break;
          const topOp = OPS[top];
          if (
            (thisOp.assoc === 'L' && thisOp.prec <= topOp.prec) ||
            (thisOp.assoc === 'R' && thisOp.prec < topOp.prec)
          ) {
            out.push(stack.pop()!);
          } else break;
        }
        stack.push(t);
        continue;
      }

      // regular operator
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (!(top in OPS)) break;
        const topOp = OPS[top];
        if (
          (thisOp.assoc === 'L' && thisOp.prec <= topOp.prec) ||
          (thisOp.assoc === 'R' && thisOp.prec < topOp.prec)
        ) {
          out.push(stack.pop()!);
        } else break;
      }
      stack.push(t);
      continue;
    }

    if (t === '(') {
      stack.push(t);
      continue;
    }
    if (t === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') {
        out.push(stack.pop()!);
      }
      if (stack.length && stack[stack.length - 1] === '(') stack.pop(); // discard '('
      else return ['NaN']; // mismatched parenthesis -> error
      continue;
    }

    // Unknown token => error
    return ['NaN'];
  }

  // drain stack
  while (stack.length) {
    const top = stack.pop()!;
    if (top === '(' || top === ')') return ['NaN'];
    out.push(top);
  }
  return out;
}

/** ---------- RPN evaluation ---------- */
function evalRPN(rpn: string[]): number {
  const st: number[] = [];
  for (const t of rpn) {
    if (!isNaN(Number(t))) {
      st.push(Number(t));
      continue;
    }
    // unary ops
    if (t in OPS && OPS[t].unary) {
      const a = st.pop();
      if (a === undefined) return NaN;
      const v = OPS[t].func!(a);
      if (!isFinite(v)) return NaN;
      st.push(v);
      continue;
    }
    // binary ops
    if (t in OPS) {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) return NaN;
      const v = OPS[t].func!(a, b);
      if (!isFinite(v)) return NaN;
      st.push(v);
      continue;
    }
    return NaN; // unknown token
  }
  return st.length === 1 ? st[0] : NaN;
}

/** Format number nicely, trimming trailing zeros. */
function fmt(n: number): string {
  if (!isFinite(n)) return 'Error';
  const s = n.toFixed(10);                // avoid float artifacts
  return s.replace(/\.?0+$/,'');          // strip trailing zeros and dot
}

/** Try to evaluate an expression string safely; returns "" if incomplete. */
function tryEval(expr: string): string {
  if (!expr) return '';
  const tokens = normalizeUnaryMinus(tokenize(expr));
  const rpn = toRPN(tokens);
  if (rpn.length === 1 && rpn[0] === 'NaN') return 'Error';
  const val = evalRPN(rpn);
  if (isNaN(val)) return 'Error';
  return fmt(val);
}

/** ---------- UI: Button ---------- */
function PadButton({
  label,
  onPress,
  type = 'default',
  flex = 1,
  testID,
}: {
  label: string;
  onPress: () => void;
  type?: 'default' | 'primary' | 'danger' | 'ghost';
  flex?: number;
  testID?: string;
}) {
  const bg =
    type === 'primary' ? '#2f6df6' :
    type === 'danger'  ? '#fa5252' :
    type === 'ghost'   ? 'transparent' :
                         '#1f2430';
  const color = type === 'ghost' ? '#c8d1e1' : '#ffffff';
  const border = type === 'ghost' ? '#394256' : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        flex,
        height: 56,
        margin: 6,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? shade(bg, 0.1) : bg,
        borderWidth: 1,
        borderColor: border,
      })}
    >
      <Text style={{ fontSize: 20, fontWeight: '600', color }}>{label}</Text>
    </Pressable>
  );
}

/** Simple color shade for pressed state */
function shade(hex: string, intensity = 0.1) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const factor = 1 - intensity;
  const h = ((r * factor) << 16) + ((g * factor) << 8) + (b * factor);
  return `#${h.toString(16).padStart(6, '0')}`;
}

/** ---------- Main App ---------- */
export default function App() {
  // expression typed by the user (e.g., "12+3×(4-2)")
  const [expr, setExpr] = React.useState<string>('');
  // computed result (live)
  const [result, setResult] = React.useState<string>('');
  // whether last action was equals (so next digit starts a new expr)
  const [justEq, setJustEq] = React.useState<boolean>(false);

  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  /** Recompute result whenever expression changes */
  React.useEffect(() => {
    if (!expr) { setResult(''); return; }
    // Only try evaluating if expression ends with a number or ')', '%' (likely "complete-ish")
    const last = expr.slice(-1);
    if (/\d|\)|%/.test(last)) {
      setResult(tryEval(expr));
    } else {
      setResult('');
    }
  }, [expr]);

  /** Append token safely, resetting after '=' if needed */
  const push = (t: string) => {
    setExpr(prev => {
      if (justEq) {
        // If user starts with operator after '=', continue chaining
        const start = BASIC.concat('^','%','×','÷' as any).includes(t)
          ? prev + t
          : t;
        setJustEq(false);
        return start;
      }
      return prev + t;
    });
  };

  /** Digit / dot */
  const onDigit = (d: string) => {
    // prevent double dots in the current number segment
    if (d === '.') {
      const seg = lastNumberSegment(expr);
      if (seg.includes('.')) return;
      if (!seg) return push('0.');
    }
    push(d);
  };

  /** Operators */
  const onOp = (op: string) => {
    if (!expr && op !== '√' && op !== '(') return; // ignore starting with binary op
    // Avoid duplicate binary operators (replace last if needed)
    if (BASIC.concat('^','×','÷' as any).includes(op)) {
      if (expr && BASIC.concat('^','×','÷' as any).includes(expr.slice(-1)))
        setExpr(prev => prev.slice(0, -1) + op);
      else push(op);
      return;
    }
    // √ can come before number or '('
    if (op === '√') {
      // If placed after a number/closing paren, insert implicit multiplication: "2√9" -> "2×√9"
      if (/\d|\)|%/.test(expr.slice(-1))) push('×');
      push('√');
      return;
    }
    if (op === '%') {
      // postfix: only if last token ends with a number or ')'
      if (!expr || !/\d|\)/.test(expr.slice(-1))) return;
      push('%');
      return;
    }
    if (op === '(') {
      // implicit multiplication: "2(" -> "2×("
      if (/\d|\)|%/.test(expr.slice(-1))) push('×');
      push('(');
      return;
    }
    if (op === ')') {
      // basic sanity: don't allow unmatched closing
      const open = (expr.match(/\(/g) || []).length;
      const close = (expr.match(/\)/g) || []).length;
      if (open > close && /\d|%|\)/.test(expr.slice(-1))) push(')');
      return;
    }
  };

  /** Equals: finalize evaluation and display result as new base */
  const onEquals = () => {
    if (!expr) return;
    const r = tryEval(expr);
    if (r && r !== 'Error') {
      setExpr(r);
      setResult('');
      setJustEq(true);
    } else {
      setResult('Error');
      setJustEq(true);
    }
  };

  /** Clear all */
  const onClear = () => {
    setExpr('');
    setResult('');
    setJustEq(false);
  };

  /** Backspace */
  const onBack = () => {
    if (!expr) return;
    setExpr(prev => prev.slice(0, -1));
  };

  /** +/- toggle for the last number segment */
  const onToggleSign = () => {
    if (!expr) return;
    const idx = lastNumberIndex(expr);
    if (idx == null) return;
    const [start, end] = idx;
    const seg = expr.slice(start, end);
    // if already negative via unary minus "…(0-<seg>)" we won't attempt to reconstruct; simple wrap:
    const wrapped = `(${seg.startsWith('-') ? seg.slice(1) : '-' + seg})`;
    setExpr(expr.slice(0, start) + wrapped + expr.slice(end));
  };

  /** Layout sizes */
  const padCols = isTablet ? 5 : 4;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0e1420' }}>
        {/* Header / Display */}
        <View style={{ padding: 20, paddingTop: Platform.OS === 'android' ? 24 : 12 }}>
          {/* Expression (scrollable behavior via TextInput without border) */}
          <TextInput
            value={expr}
            editable={false}
            multiline
            selectTextOnFocus={false}
            style={{
              color: '#c8d1e1',
              fontSize: isTablet ? 28 : 22,
              minHeight: 60,
            }}
            placeholder="Enter expression"
            placeholderTextColor="#59647c"
          />
          {/* Live Result */}
          <Text
            accessibilityLabel="result"
            style={{
              marginTop: 6,
              color: result === 'Error' ? '#fa5252' : '#9bb0d3',
              fontSize: isTablet ? 40 : 32,
              fontWeight: '700',
              textAlign: 'right',
            }}
          >
            {result || (expr ? '' : '0')}
          </Text>
        </View>

        {/* Keypad */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 12 }}>
          {/* Top row: advanced ops */}
          <Row>
            <PadButton label="AC" type="danger" onPress={onClear} />
            <PadButton label="⌫" onPress={onBack} />
            <PadButton label="(" onPress={() => onOp('(')} />
            <PadButton label=")" onPress={() => onOp(')')} />
            <PadButton label="^" onPress={() => onOp('^')} />
          </Row>

          {/* Second row: √, %, +/- and ÷ */}
          <Row>
            <PadButton label="√" onPress={() => onOp('√')} />
            <PadButton label="%" onPress={() => onOp('%')} />
            <PadButton label="+/-" onPress={onToggleSign} />
            <PadButton label="÷" type="primary" onPress={() => onOp('÷')} />
          </Row>

          {/* Digit grid + basic ops */}
          <Grid columns={padCols}>
            {['7','8','9','×','4','5','6','-','1','2','3','+','0','.','='].map(k => {
              // Rightmost ops in each row styled as primary
              const type =
                k === '=' || k === '+' || k === '-' || k === '×' || k === '÷'
                  ? (k === '=' ? 'primary' : 'primary')
                  : 'default';
              const handler = () => {
                if (k === '=') return onEquals();
                if (['+','-','×'].includes(k)) return onOp(k);
                if (k === '.') return onDigit('.');
                if (/\d/.test(k)) return onDigit(k);
                // guard for completeness
                return;
              };
              // make 0 take 2 columns on phone (optional)
              const flex =
                !isTablet && k === '0' && padCols === 4 ? 2 : 1;
              return <PadButton key={k} label={k} onPress={handler} type={type as any} flex={flex} />;
            })}
          </Grid>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** ---------- Layout primitives ---------- */

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 }}>
      {children}
    </View>
  );
}

function Grid({ columns, children }: { columns: number; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View style={{ marginTop: 6 }}>
      {rows.map((row, idx) => (
        <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {row}
        </View>
      ))}
    </View>
  );
}

/** ---------- Small parsing utilities ---------- */

/** Returns the last contiguous number segment indices [start, end) in expr, or null. */
function lastNumberIndex(expr: string): [number, number] | null {
  if (!expr) return null;
  let i = expr.length - 1;
  // handle trailing '%' or ')' first
  if (expr[i] === '%' || expr[i] === ')') return null;
  // scan backward while digit or dot
  while (i >= 0 && /[\d.]/.test(expr[i])) i--;
  const start = i + 1;
  const end = expr.length;
  return start < end ? [start, end] : null;
}

/** Returns the last number segment string ("" if none). */
function lastNumberSegment(expr: string): string {
  const idx = lastNumberIndex(expr);
  if (!idx) return '';
  return expr.slice(idx[0], idx[1]);
}
