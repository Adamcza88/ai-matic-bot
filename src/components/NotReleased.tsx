type Props = {
  message?: string;
};

export default function NotReleased({ message }: Props) {
  return (
    <div className="not-released-shell min-h-screen flex items-center justify-center text-center p-6">
      <div className="not-released-card max-w-[520px] rounded-2xl border p-7 shadow-2xl">
        <h1 className="not-released-title text-[28px] mb-3 font-semibold">
          Not yet publicly released
        </h1>
        <p className="not-released-copy">
          Access is limited to the allowlisted testers right now.
        </p>
        {message && (
          <p className="not-released-message mt-3 text-sm">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
