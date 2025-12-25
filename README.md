# GitHub Wrapped 2025

A Spotify Wrapped-style year-in-review for your GitHub activity. See your coding stats, streaks, top repositories, and more in a beautiful dark-themed visualization.

**Live Demo:** https://isfarbaset.github.io/git-wrapped/

## Features

- **Stats Overview**: Total commits, PRs, issues, and repositories contributed to
- **Streak Tracking**: See your longest and current coding streaks
- **Developer Personality**: Fun personality badge based on your activity
- **Top Repositories**: Bar chart of your most active repos with medals
- **Monthly Contributions**: See which month you were most productive
- **Activity Heatmaps**: When do you code? Day of week and time of day analysis
- **Language Breakdown**: What programming languages did you use?
- **Fun Facts**: Entertaining stats about your coding year

## Setup

### Prerequisites

- Python 3.8+
- Quarto CLI (https://quarto.org/docs/get-started/)
- GitHub Personal Access Token (for accurate data via GraphQL API)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/isfarbaset/git-wrapped.git
   cd git-wrapped
   ```

2. Install Python dependencies:
   ```bash
   pip install requests
   ```

3. Set up a GitHub Personal Access Token:
   ```bash
   export GITHUB_TOKEN="your_github_token_here"
   ```
   
   To create a token: GitHub Settings > Developer Settings > Personal Access Tokens > Tokens (classic)
   Required scope: `public_repo`

4. Edit `index.qmd` and change the `GITHUB_USERNAME` variable to your GitHub username:
   ```python
   GITHUB_USERNAME = "your_username_here"
   ```

### Render

To generate your GitHub Wrapped:

```bash
export GITHUB_TOKEN="your_token"
quarto render index.qmd
```

The output will be in the `docs/` folder, ready for GitHub Pages.

### Deploy to GitHub Pages

1. Push the `docs/` folder to your repository
2. Go to your repo Settings > Pages
3. Set source to "Deploy from a branch" and select `main` branch, `/docs` folder
4. Your GitHub Wrapped will be live at `https://yourusername.github.io/git-wrapped/`

## Customization

### Change the Year

Edit the `YEAR` variable in `index.qmd`:
```python
YEAR = 2025
```

### Styling

Modify `styles.css` to customize colors, fonts, and layout. The main GitHub color variables:

```css
:root {
  --gh-dark: #0d1117;
  --gh-green: #238636;
  --gh-blue: #58a6ff;
  --gh-purple: #a371f7;
  --gh-orange: #d29922;
}
```

## API Rate Limits

Without authentication, GitHub API allows 60 requests per hour. With a personal access token, you get 5,000 requests per hour. The GraphQL API (used for accurate contribution data) requires authentication.

## Privacy

This project only accesses public GitHub data. Your personal access token is only stored locally and never transmitted to any third party.

## License

MIT License - feel free to use, modify, and share!
