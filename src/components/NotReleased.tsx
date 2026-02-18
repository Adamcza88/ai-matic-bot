import { UI_COPY } from "@/lib/uiCopy";

type Props = {
  message?: string;
};

export default function NotReleased({ message }: Props) {
  return (
    <div className="not-released-shell min-h-screen flex items-center justify-center text-center p-6">
      <div className="not-released-card max-w-[520px] rounded-2xl border p-7 shadow-2xl">
        <h1 className="not-released-title text-[28px] mb-3 font-semibold">
          {UI_COPY.notReleased.title}
        </h1>
        <p className="not-released-copy">
          {UI_COPY.notReleased.description}
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
