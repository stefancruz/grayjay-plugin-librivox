# LibriVox API Issues Report

**Date**: June 26, 2025  
**API Base URL**: https://librivox-api.openaudiobooks.org  
**Reported By**: Grayjay Plugin Development Team  

## Executive Summary

We've identified several critical issues with the LibriVox API that are impacting our integration. This report documents the problems found during testing, including broken endpoints, missing data fields, and inconsistent response formats.

## Critical Issues

### 1. Author Search Endpoint Returns Server Errors

**Endpoint**: `GET /api/feed/authors/search`  
**Example Request**:
```bash
curl -H "x-api-key: [API_KEY]" \
  "https://librivox-api.openaudiobooks.org/api/feed/authors/search?q=shakespeare"
```

**Expected Response**: Array of author objects  
**Actual Response**:
```json
{
  "error": {
    "code": "SERVER_ERROR",
    "message": "Error performing search",
    "request_id": "req-1750955771829-dme1nlsnq",
    "timestamp": "2025-06-26T16:36:11.831Z"
  }
}
```

**Impact**: Users cannot search for authors by name  
**Severity**: HIGH - Core functionality broken

### 2. Book Search Returns Empty Results

**Endpoint**: `GET /api/feed/audiobooks/search`  
**Example Request**:
```bash
curl -H "x-api-key: [API_KEY]" \
  "https://librivox-api.openaudiobooks.org/api/feed/audiobooks/search?format=json&extended=1&coverart=1&limit=2&offset=0&q=alice"
```

**Expected Response**: Books matching "alice" (e.g., "Alice in Wonderland")  
**Actual Response**:
```json
{
  "books": []
}
```

**Test Queries Returning Empty**:
- `q=alice`
- `q=shakespeare`
- `q=dickens`

**Impact**: Search functionality non-functional  
**Severity**: HIGH - Users cannot discover content


### 3. Inconsistent Cover Art Fields

**Issue**: Books have `coverart_jpg: null` but valid `coverart_thumbnail`

**Example Response**:
```json
{
  "id": 21720,
  "title": "Set-Up",
  "coverart_jpg": null,
  "coverart_thumbnail": "https://librivox-api.openaudiobooks.org/api/v2/proxy/coverart_thumbnail/21720"
}
```

**Expected**: Both fields populated or clear documentation on which to use  
**Impact**: Inconsistent image display across the app  
**Severity**: MEDIUM - Affects visual presentation

### 4. Undocumented Response Formats

**Issue**: Error responses have different structures across endpoints

**Example 1** (Author search):
```json
{
  "error": {
    "code": "SERVER_ERROR",
    "message": "Error performing search"
  }
}
```

**Example 2** (Invalid book ID):
```json
{
  "error": "Audiobook not found"
}
```

**Expected**: Consistent error response format  
**Impact**: Difficult to implement proper error handling  
**Severity**: MEDIUM - Complicates client implementation

## Additional Observations

### Response Time Issues
- Author search endpoint frequently times out or returns 500 errors
- Book search is slow even when returning empty results

### Data Quality Issues
- Some books missing language information
- Author `imageurl` field frequently null despite authors having Wikipedia entries with images
- Inconsistent date formats across different endpoints

## Recommendations

1. **Fix Search Endpoints**: Both author and book search need immediate attention
2. **Standardize Error Responses**: Use consistent error format across all endpoints
3. **API Documentation**: Update docs to clarify which fields are guaranteed vs optional
4. **Add Health Check Endpoint**: For monitoring API availability

## Test Environment

- **Testing Date**: June 26, 2025
- **API Key Used**: Provided via x-api-key header
- **Client**: curl/HTTP direct requests
- **Network Location**: Various (confirmed not a regional issue)

## Request for Action

We request the API team to:

1. Investigate and fix the search endpoint failures
2. Ensure all book sections include the required fields
3. Provide timeline for fixes
4. Consider implementing a staging/test environment for integration testing

## Contact Information

For questions or clarification about these issues, please contact the Grayjay plugin development team.

## Appendix: Working Endpoints

For reference, these endpoints are functioning correctly:

- `GET /api/feed/audiobooks` - Latest books list
- `GET /api/feed/authors/id/{id}` - Get author by ID
- `GET /api/feed/authors/{id}/audiobooks` - Get books by author
- `GET /api/v2/proxy/{section_id}.mp3` - Audio file proxy

---

We appreciate your attention to these issues and look forward to working together to resolve them.