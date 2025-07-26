# SpoilWatch - Chrome Extension

A modern Chrome extension that protects you from spoilers while browsing YouTube and other content platforms.

## Features

### 🎬 Trending Movie Keywords
- Automatically fetches trending movies from OMDb API
- Displays relevant keywords as clickable chips
- Click to add keywords to your blocked list
- "See More" functionality to expand keyword lists

### 📚 Keyword History
- View and manage your blocked keywords
- Visual feedback for already blocked keywords
- Remove keywords from history with one click
- Clean, organized interface

### ⚙️ Settings (Coming Soon)
- Advanced configuration options
- Customizable spoiler protection behavior

### 📊 Analytics (Coming Soon)
- Detailed statistics about your spoiler protection
- Insights and usage data

## UI Improvements

The extension has been completely redesigned with modern UI principles:

### 🎨 Visual Design
- **Glassmorphism Effects**: Modern backdrop blur and transparency
- **Enhanced Gradients**: Beautiful color transitions throughout the interface
- **Improved Typography**: Better font weights, spacing, and readability
- **Modern Shadows**: Subtle depth and elevation effects

### ✨ Animations & Interactions
- **Smooth Transitions**: All interactions use cubic-bezier easing
- **Micro-interactions**: Hover effects, scale transforms, and feedback
- **Loading States**: Spinner animations for data fetching
- **Shimmer Effects**: Subtle animations on buttons and cards

### 📱 Responsive Design
- **Mobile-First**: Optimized for all screen sizes
- **Flexible Grid**: Adaptive card layouts
- **Touch-Friendly**: Larger touch targets and better spacing

### 🎯 User Experience
- **Intuitive Navigation**: Clear feature selection and back navigation
- **Visual Feedback**: Immediate response to user actions
- **Error Handling**: Graceful error states with helpful messages
- **Empty States**: Friendly messages when no data is available

### 🎪 Feature Cards
- **Icon Integration**: Emoji icons for each feature
- **Descriptive Text**: Clear explanations of functionality
- **Hover Effects**: Engaging interactive elements
- **Consistent Styling**: Unified design language

## Technical Features

- **Chrome Storage API**: Persistent keyword storage
- **Content Script Injection**: Seamless overlay integration
- **API Integration**: OMDb for movie data
- **Real-time Blocking**: Instant spoiler protection
- **Cross-tab Sync**: Consistent experience across tabs

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder
5. The SpoilWatch icon will appear in your toolbar

## Usage

1. **Add Keywords**: Enter spoiler keywords in the popup
2. **Open Fullscreen**: Click "Open Fullscreen" for advanced features
3. **Trending Keywords**: Discover and block movie-related spoilers
4. **Manage History**: View and organize your blocked keywords

## Development

The extension uses:
- **Vanilla JavaScript**: No frameworks required
- **CSS3 Features**: Modern styling with fallbacks
- **Chrome Extension APIs**: Native browser integration
- **Responsive Design**: Works on all devices

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is open source and available under the MIT License.
