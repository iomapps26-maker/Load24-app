/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AIAgentChat from './pages/AIAgentChat';
import AccountsDashboard from './pages/AccountsDashboard';
import AddMoney from './pages/AddMoney';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminDashboard from './pages/AdminDashboard';
import AdminLogin from './pages/AdminLogin';
import AdminReports from './pages/AdminReports';
import AdminVerify from './pages/AdminVerify';
import Dashboard from './pages/Dashboard';
import DocumentApproval from './pages/DocumentApproval';
import DocumentVerification from './pages/DocumentVerification';
import DriverApp from './pages/DriverApp';
import DriverLogin from './pages/DriverLogin';
import DriverTracking from './pages/DriverTracking';
import EmployeeLogin from './pages/EmployeeLogin';
import EmployeeRedirect from './pages/EmployeeRedirect';
import FinanceManagement from './pages/FinanceManagement';
import FinancialProjection from './pages/FinancialProjection';
import FindLoads from './pages/FindLoads';
import FindTrucks from './pages/FindTrucks';
import IoTMonitor from './pages/IoTMonitor';
import KYCVerification from './pages/KYCVerification';
import LoadDocuments from './pages/LoadDocuments';
import MarkUnloadingEntry from './pages/MarkUnloadingEntry';
import Membership from './pages/Membership';
import MobileLogin from './pages/MobileLogin';
import MobileSignup from './pages/MobileSignup';
import MyDeals from './pages/MyDeals';
import MyLikes from './pages/MyLikes';
import MyPerformance from './pages/MyPerformance';
import MyTeam from './pages/MyTeam';
import MyTrucks from './pages/MyTrucks';
import MyWallet from './pages/MyWallet';
import Notifications from './pages/Notifications';
import Onboarding from './pages/Onboarding';
import OnboardingCampaign from './pages/OnboardingCampaign';
import PendingNotifications from './pages/PendingNotifications';
import PerformanceTargets from './pages/PerformanceTargets';
import PostEmptyTruck from './pages/PostEmptyTruck';
import PostLoad from './pages/PostLoad';
import Profile from './pages/Profile';
import ProfileSetup from './pages/ProfileSetup';
import ProfitCalculator from './pages/ProfitCalculator';
import RaiseTicket from './pages/RaiseTicket';
import ReferralProgram from './pages/ReferralProgram';
import ReportLoadingIssue from './pages/ReportLoadingIssue';
import SalesDashboard from './pages/SalesDashboard';
import SelectAdvance from './pages/SelectAdvance';
import ShipperPayment from './pages/ShipperPayment';
import ShipperTracking from './pages/ShipperTracking';
import SubmitRating from './pages/SubmitRating';
import SupportChat from './pages/SupportChat';
import TransactionHistory from './pages/TransactionHistory';
import TruckMaintenance from './pages/TruckMaintenance';
import TruckOwnerDashboard from './pages/TruckOwnerDashboard';
import TruckTracking from './pages/TruckTracking';
import TwilioSettings from './pages/TwilioSettings';
import VerifyShipperPayments from './pages/VerifyShipperPayments';
import ViewLoadDocuments from './pages/ViewLoadDocuments';
import ViewShipperProfile from './pages/ViewShipperProfile';
import WebTracking from './pages/WebTracking';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AIAgentChat": AIAgentChat,
    "AccountsDashboard": AccountsDashboard,
    "AddMoney": AddMoney,
    "AdminAnalytics": AdminAnalytics,
    "AdminDashboard": AdminDashboard,
    "AdminLogin": AdminLogin,
    "AdminReports": AdminReports,
    "AdminVerify": AdminVerify,
    "Dashboard": Dashboard,
    "DocumentApproval": DocumentApproval,
    "DocumentVerification": DocumentVerification,
    "DriverApp": DriverApp,
    "DriverLogin": DriverLogin,
    "DriverTracking": DriverTracking,
    "EmployeeLogin": EmployeeLogin,
    "EmployeeRedirect": EmployeeRedirect,
    "FinanceManagement": FinanceManagement,
    "FinancialProjection": FinancialProjection,
    "FindLoads": FindLoads,
    "FindTrucks": FindTrucks,
    "IoTMonitor": IoTMonitor,
    "KYCVerification": KYCVerification,
    "LoadDocuments": LoadDocuments,
    "MarkUnloadingEntry": MarkUnloadingEntry,
    "Membership": Membership,
    "MobileLogin": MobileLogin,
    "MobileSignup": MobileSignup,
    "MyDeals": MyDeals,
    "MyLikes": MyLikes,
    "MyPerformance": MyPerformance,
    "MyTeam": MyTeam,
    "MyTrucks": MyTrucks,
    "MyWallet": MyWallet,
    "Notifications": Notifications,
    "Onboarding": Onboarding,
    "OnboardingCampaign": OnboardingCampaign,
    "PendingNotifications": PendingNotifications,
    "PerformanceTargets": PerformanceTargets,
    "PostEmptyTruck": PostEmptyTruck,
    "PostLoad": PostLoad,
    "Profile": Profile,
    "ProfileSetup": ProfileSetup,
    "ProfitCalculator": ProfitCalculator,
    "RaiseTicket": RaiseTicket,
    "ReferralProgram": ReferralProgram,
    "ReportLoadingIssue": ReportLoadingIssue,
    "SalesDashboard": SalesDashboard,
    "SelectAdvance": SelectAdvance,
    "ShipperPayment": ShipperPayment,
    "ShipperTracking": ShipperTracking,
    "SubmitRating": SubmitRating,
    "SupportChat": SupportChat,
    "TransactionHistory": TransactionHistory,
    "TruckMaintenance": TruckMaintenance,
    "TruckOwnerDashboard": TruckOwnerDashboard,
    "TruckTracking": TruckTracking,
    "TwilioSettings": TwilioSettings,
    "VerifyShipperPayments": VerifyShipperPayments,
    "ViewLoadDocuments": ViewLoadDocuments,
    "ViewShipperProfile": ViewShipperProfile,
    "WebTracking": WebTracking,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};