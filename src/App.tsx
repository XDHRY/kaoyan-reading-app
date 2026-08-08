import { Routes, Route } from "react-router";
import { Layout } from "@/components/Layout";
import { UserProvider } from "@/hooks/useUser";
import { FontSizeProvider } from "@/hooks/useFontSize";
import { ThemeProvider } from "@/hooks/useTheme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProfileGate } from "@/components/ProfileGate";
import { ToastProvider } from "@/hooks/useToast";
import Home from "@/pages/Home";
import SopPage from "@/pages/SopPage";
import LibraryPage from "@/pages/LibraryPage";
import PracticePage from "@/pages/PracticePage";
import SettingsPage from "@/pages/SettingsPage";
import PromptsPage from "@/pages/PromptsPage";
import GeneratePage from "@/pages/GeneratePage";
import InteractivePage from "@/pages/InteractivePage";
import GuidePage from "@/pages/GuidePage";
import ManualPage from "@/pages/ManualPage";
import TicketsPage from "@/pages/TicketsPage";
import WrongBookPage from "@/pages/WrongBookPage";
import VocabPage from "@/pages/VocabPage";
import StatsPage from "@/pages/StatsPage";
import MePage from "@/pages/MePage";
import HistoryPage from "@/pages/HistoryPage";
import AdminPage from "@/pages/AdminPage";
import InsightPage from "@/pages/InsightPage";
import EssayPage from "@/pages/EssayPage";
import EssayDraftPage from "@/pages/EssayDraftPage";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <FontSizeProvider>
      <ThemeProvider>
        <UserProvider>
          <ToastProvider>
          <ProfileGate />
          <Layout>
            <ErrorBoundary>
              <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sop" element={<SopPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/practice/:id" element={<PracticePage />} />
            <Route path="/wrong" element={<WrongBookPage />} />
            <Route path="/vocab" element={<VocabPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/generate" element={<GeneratePage />} />
            <Route path="/generate/set/:id" element={<GeneratePage />} />
            <Route path="/interactive/:kind/:id" element={<InteractivePage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/manual" element={<ManualPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/me" element={<MePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/insight" element={<InsightPage />} />
            <Route path="/essay" element={<EssayPage />} />
            <Route path="/essay/draft/:draftId" element={<EssayDraftPage />} />
            <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </Layout>
          </ToastProvider>
        </UserProvider>
      </ThemeProvider>
    </FontSizeProvider>
  );
}
