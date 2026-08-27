import { Route, Routes, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Dashboard from './pages/Dashboard.jsx'
import NotFound from './pages/NotFound.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import DashboardLayout from './layouts/DashboardLayout.jsx'

function App() {
  return (
    <Routes>
      {/* Public Routes without Layout */}
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      
      {/* Shared Dashboard Layout for Guests and Authenticated Users */}
      <Route element={<DashboardLayout />}>
         
         {/* Guest / Public Passenger Route */}
         <Route path="/home" element={<Home />} />

         {/* Protected Conductor Routes */}
         <Route element={<ProtectedRoute roles={['CONDUCTOR', 'ADMIN']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/map" element={<Dashboard />} />
         </Route>

         {/* Protected Admin Routes */}
         <Route element={<ProtectedRoute roles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/buses" element={<AdminDashboard />} />
            <Route path="/admin/routes" element={<AdminDashboard />} />
            <Route path="/admin/stops" element={<AdminDashboard />} />
            <Route path="/admin/conductors" element={<AdminDashboard />} />
            <Route path="/admin/analytics" element={<AdminDashboard />} />
         </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
