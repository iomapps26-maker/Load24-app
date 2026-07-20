import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import GlobalErrorHandler from '@/components/common/GlobalErrorHandler';
import Home from './pages/Home';
import HowItWorksStep1 from './pages/HowItWorksStep1';
import HowItWorksStep2 from './pages/HowItWorksStep2';
import HowItWorksStep3 from './pages/HowItWorksStep3';
import DeleteAccount from './pages/DeleteAccount';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import VerifyWhatsApp from './pages/VerifyWhatsApp';
import PaymentDetails from './pages/PaymentDetails';
import __Layout from './Layout.jsx';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <GlobalErrorHandler>
          <Router>
            <NavigationTracker />
            <Routes>
              {/* Public routes — no auth required */}
              <Route path="/" element={<__Layout currentPageName="Home"><Home /></__Layout>} />
              <Route path="/Home" element={<__Layout currentPageName="Home"><Home /></__Layout>} />
              <Route path="/how-it-works-step1" element={<__Layout currentPageName="HowItWorksStep1"><HowItWorksStep1 /></__Layout>} />
              <Route path="/how-it-works-step2" element={<__Layout currentPageName="HowItWorksStep2"><HowItWorksStep2 /></__Layout>} />
              <Route path="/how-it-works-step3" element={<__Layout currentPageName="HowItWorksStep3"><HowItWorksStep3 /></__Layout>} />
              <Route path="/DeleteAccount" element={<__Layout currentPageName="DeleteAccount"><DeleteAccount /></__Layout>} />
              <Route path="/delete-account" element={<__Layout currentPageName="DeleteAccount"><DeleteAccount /></__Layout>} />
              <Route path="/PrivacyPolicy" element={<__Layout currentPageName="PrivacyPolicy"><PrivacyPolicy /></__Layout>} />
              <Route path="/privacy-policy" element={<__Layout currentPageName="PrivacyPolicy"><PrivacyPolicy /></__Layout>} />
              <Route path="/TermsOfService" element={<__Layout currentPageName="TermsOfService"><TermsOfService /></__Layout>} />
              <Route path="/terms-of-service" element={<__Layout currentPageName="TermsOfService"><TermsOfService /></__Layout>} />
              <Route path="/verify-whatsapp" element={<__Layout currentPageName="VerifyWhatsApp"><VerifyWhatsApp /></__Layout>} />
              <Route path="/PaymentDetails" element={<__Layout currentPageName="PaymentDetails"><PaymentDetails /></__Layout>} />
              {/* All other routes require authentication */}
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
          <SonnerToaster position="top-center" richColors closeButton />
        </GlobalErrorHandler>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App