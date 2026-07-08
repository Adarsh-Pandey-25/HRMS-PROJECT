export type Role = 'admin' | 'hr' | 'manager' | 'employee'

export type Employee = {
  id: string
  employeeCode?: string
  firstName: string
  lastName: string
  email: string
  role: Role
  department?: string
  designation?: string
  isActive?: boolean
  managerId?: string
  manager?: { id?: string; firstName?: string; lastName?: string }
}

export type AttendanceRecord = {
  id: string
  date?: string
  checkInTime?: string
  checkOutTime?: string
  checkInIp?: string
  checkOutIp?: string
  status: string
  totalHours?: number
  employee?: Employee
}

export type LeaveRecord = {
  id: string
  leaveType: string
  fromDate: string
  toDate: string
  isHalfDay?: boolean
  reason?: string
  status: string
  totalDays?: number
  employee?: Employee
  managerApproved?: boolean
  hrApproved?: boolean
  createdAt?: string
}

export type Reimbursement = {
  id: string
  reimbursementType: string
  amount: number
  description?: string
  expenseDate: string
  status: string
  receiptUrl?: string
  employee?: Employee
  managerApproved?: boolean
  hrApproved?: boolean
}

export type Payslip = {
  id: string
  month: number
  year: number
  grossSalary: number
  netSalary: number
  status: string
  generatedAt?: string
}

export type Holiday = {
  id: string
  name?: string
  title?: string
  date: string
  type: string
  description?: string
}

export type Announcement = {
  id: string
  title: string
  content: string
  priority: string
  targetAudience: string
  isActive: boolean
  publishedAt?: string
  expiresAt?: string
  publisher?: { firstName: string; lastName: string }
}

export type Training = {
  id: string
  title: string
  description?: string
  category?: string
  startDate?: string
  endDate?: string
  status?: string
}

export type EmployeeTraining = {
  id: string
  status: string
  progress?: number
  completedAt?: string
  training?: Training
}

export type Document = {
  id: string
  documentType: string
  documentName: string
  uploadedAt?: string
  expiresAt?: string
}

export type Setting = {
  id?: string
  key: string
  value: string
  description?: string
}

export type ApiMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}
