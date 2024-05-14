This tool uses the SailPoint TypeScript SDK to extend the SailPoint CIEM Resource Access Reports with additional identity and access attributes.

The tool expects a standard directory structure for input/output reports.

![image](https://github.com/mostafa-helmy-sp/isc-ciem-governance-framework/assets/88710756/1f398bcf-15f4-462c-baf4-137e06e72b8c)

Currently the CIEM reports ZIP files must be manually downloaded and placed in the ciem_input_reports directory.

Extended reports are created in a directory under the ciem_output_reports directory.

Custom Reports can also be created by running filters across specific or all extended reports. The Full Access Paths can optionally be included in custom reports.

Here are some examples from the index.ts.

```typescript
    // Create Extended Reports
    await reportSrv.createIdentifiedResourceAccessReports()

    // Cleanup an existing Custom Reports
    fsSrv.cleanupDirectory(reportSrv.getCustomOutputReportsDir())

    // Filter applied to a specific CSP + Service Report with Access Paths included
    let reportName = 'terminated_aws_lambda_admins.csv'
    let filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`
    let includeAccessPaths = true
    let csp = 'aws'
    let service = 'lambda'
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths, csp, service)

    // Filter for a specific Identity across all CSP/Service Reports without Access Paths
    reportName = 'all_access_Juan.Hamilton.csv'
    filter = `record.IdentityUsername === 'Juan.Hamilton'`
    includeAccessPaths = true
    await reportSrv.createCustomReport(reportName, filter, includeAccessPaths)

    // Filter across all CSP/Service Reports without Access Paths
    reportName = 'terminated_csp_admins.csv'
    filter = `record.AccessLevel.includes('A') && record.IdentityLifecycleState === 'inactive'`
    await reportSrv.createCustomReport(reportName, filter)
```
