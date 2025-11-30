import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";

type Props = {
  onLogin: () => void;
  isAuthenticating: boolean;
  error?: string;
  allowGuests?: boolean;
  onGuestLogin?: () => void;
};

export default function LoginCard({
  onLogin,
  isAuthenticating,
  error,
  allowGuests,
  onGuestLogin,
}: Props) {
  return (
    <div
      className="min-h-screen flex flex-col gap-9 items-center justify-center bg-linear-to-br from-slate-950 to-slate-900 p-6"
      style={{
        backgroundImage: 'url(/loginBackground.svg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="flex flex-col items-center justify-center h-full text-6xl font-bold text-white">AI Matic</div>
      <Card className="w-full max-w-md bg-white/5 backdrop-blur-lg border-white/10 text-white shadow-2xl p-6">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <Logo className="w-16 h-16 text-blue-600" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-bold tracking-tighter">
              Welcome back
            </CardTitle>
            <CardDescription className="text-slate-400">
              Sign in with your allowlisted Google account to continue.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            onClick={onLogin}
            disabled={isAuthenticating}
          >
            {isAuthenticating ? "Redirecting..." : "Continue with Google"}
          </Button>

          {allowGuests && onGuestLogin && (
            <Button
              variant="outline"
              className="w-full border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={onGuestLogin}
              disabled={isAuthenticating}
            >
              Continue as Guest
            </Button>
          )}

          {error && (
            <p className="text-sm text-orange-500 text-center">{error}</p>
          )}
        </CardContent>
      </Card>
    </div >
  );
}
