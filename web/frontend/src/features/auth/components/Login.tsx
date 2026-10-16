import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScriberrLogo } from "@/components/ScriberrLogo";
import { useNavigate } from "react-router-dom";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Loader2, AlertCircle, ArrowRight, AudioLines, FileAudio, Users, NotebookPen, MessageSquareText } from "lucide-react";
import "./Login.css";
const features = [
    { icon: FileAudio, title: "Upload audio & video", description: "Turn recordings into readable transcripts." },
    { icon: AudioLines, title: "Realtime transcription", description: "See your words as you speak." },
    { icon: Users, title: "Speaker identification", description: "Follow who said what." },
    { icon: NotebookPen, title: "Meeting summaries", description: "Revisit decisions and next steps." },
];

function LoginFeatures() {
    return <ul className="login-features" aria-label={translateUI("What you can do with MeetingScribe")}>
        {features.map(({icon: Icon, title, description}) => <li key={title}>
            <span className="login-feature-icon"><Icon aria-hidden="true" size={19}/></span>
            <div><h3>{translateUI(title)}</h3><p>{translateUI(description)}</p></div>
        </li>)}
    </ul>;
}

function TranscriptExample() {
    return <figure className="login-example" aria-label={translateUI("Example transcript, using fictional content")}>
        <figcaption className="login-example-heading">
            <span><MessageSquareText aria-hidden="true" size={16}/>{translateUI("From conversation to clarity")}</span>
            <span className="login-example-badge">{translateUI("Fictional example")}</span>
        </figcaption>
        <div className="login-example-lines">
            <div className="login-example-line">
                <time>00:12</time><span className="login-speaker login-speaker-one">{translateUI("Speaker 1")}</span>
                <p>{translateUI("Let's confirm the plan for next week first.")}</p>
            </div>
            <div className="login-example-line">
                <time>00:19</time><span className="login-speaker login-speaker-two">{translateUI("Speaker 2")}</span>
                <p>{translateUI("I'll organize the materials and send a draft on Friday.")}</p>
            </div>
        </div>
        <div className="login-example-summary"><NotebookPen aria-hidden="true" size={15}/><p><strong>{translateUI("Next step")}</strong> {translateUI("Prepare the materials · Share the draft on Friday")}</p></div>
    </figure>;
}

interface LoginProps {
    onLogin: (token: string) => void;
}
export function Login({ onLogin }: LoginProps) {
    useInterfaceLanguage();
    const navigate = useNavigate();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const response = await fetch("/api/v1/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username,
                    password,
                }),
            });
            if (response.ok) {
                const data = await response.json();
                onLogin(data.token);
            }
            else {
                const error = await response.json();
                setError(error.error || "Login failed");
            }
        }
        catch (error) {
            console.error("Login error:", error);
            setError("Network error. Please try again.");
        }
        finally {
            setLoading(false);
        }
    };
    const isFormValid = username.trim() && password.trim();
    return <div className="login-page">
        <header className="login-header">
            <ScriberrLogo onClick={() => navigate('/')}/>
            <ThemeSwitcher/>
        </header>
        <main className="login-main">
            <section className="login-introduction" aria-labelledby="login-intro-title">
                <p className="login-eyebrow">{translateUI("YOUR MEETING WORKSPACE")}</p>
                <h1 id="login-intro-title">{translateUI("Let every meeting leave")}<br/><span>{translateUI("a clear, lasting record.")}</span></h1>
                <p className="login-intro-description">{translateUI("Capture conversations, follow each speaker, and turn your recordings into useful meeting notes.")}</p>
                <div className="login-desktop-details"><LoginFeatures/><TranscriptExample/></div>
            </section>
            <section className="login-form-panel" aria-labelledby="login-form-title">
                <div className="login-form-card">
                    <p className="login-form-kicker">MeetingScribe</p>
                    <h2 id="login-form-title">{translateUI("Welcome back")}</h2>
                    <p className="login-form-description">{translateUI("Sign in to continue to your workspace")}</p>
                    <form onSubmit={handleSubmit} className="login-form" aria-busy={loading}>
                        {error && <div id="login-error" role="alert" className="login-error"><AlertCircle aria-hidden="true" size={18}/><p>{translateUI(error)}</p></div>}
                        <div className="login-field">
                            <Label htmlFor="username">{translateUI("Username")}</Label>
                            <Input id="username" type="text" placeholder={translateUI("Enter your username")} value={username} onChange={e => setUsername(e.target.value)} disabled={loading} required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby={error ? 'login-error' : undefined}/>
                        </div>
                        <div className="login-field">
                            <Label htmlFor="password">{translateUI("Password")}</Label>
                            <Input id="password" type="password" placeholder={translateUI("Enter your password")} value={password} onChange={e => setPassword(e.target.value)} disabled={loading} required autoComplete="current-password" aria-describedby={error ? 'login-error' : undefined}/>
                        </div>
                        <Button type="submit" disabled={loading || !isFormValid} className="login-submit">
                            {loading ? <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>{translateUI("Signing in...")}</> : <>{translateUI("Sign In")}<ArrowRight aria-hidden="true" className="h-4 w-4"/></>}
                        </Button>
                    </form>
                    <div className="login-account-help"><p>{translateUI("Your account is provided by your administrator.")}</p><p>{translateUI("Forgot your password? Contact your administrator.")}</p></div>
                </div>
                <p className="login-form-footer">{translateUI("Your conversations. Organized and ready to revisit.")}</p>
            </section>
            <section className="login-mobile-details" aria-label={translateUI("Explore MeetingScribe")}><LoginFeatures/><TranscriptExample/></section>
        </main>
        <footer className="login-footer">MeetingScribe <span aria-hidden="true">·</span> {translateUI("Audio transcription & meeting notes")}</footer>
    </div>;
}
