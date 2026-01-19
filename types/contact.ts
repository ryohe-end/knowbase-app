export type Contact = {
  contactId: string;
  name: string;
  email: string;
  notificationEmails?: string[];
  brandId: string; // "ALL" or brandId
  deptId: string;
  role?: string;
};
