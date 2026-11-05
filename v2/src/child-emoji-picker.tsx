const symbols = [
  "⭐", "🌟", "🐱", "🐶", "🐰", "🦊", "🐼", "🐨", "🐯", "🦁", "🦄", "🐸",
  "🐙", "🦋", "🐬", "🦉", "🐢", "🐝", "🌈", "🌻", "🚀", "⚽", "🎨", "🎮",
];

type Props = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

export function ChildEmojiPicker({ value, disabled, onChange }: Props) {
  return (
    <fieldset className="memberSymbols" disabled={disabled}>
      <legend>בחירת סמל {value}</legend>
      <div className="memberSymbolGrid">
        {symbols.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className="button"
            aria-pressed={value === symbol}
            onClick={() => onChange(symbol)}
          >
            {symbol}
          </button>
        ))}
      </div>
      <details className="memberCustomSymbol">
        <summary>סמל אחר</summary>
        <label>
          סמל מותאם אישית
          <input
            value={value}
            maxLength={16}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </details>
    </fieldset>
  );
}
