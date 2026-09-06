#!/usr/bin/env perl
# Accurate <lastmod> values. Each sitemap URL is mapped to its HTML file and
# dated from the file's last commit; a file with uncommitted changes is
# dated today. Run from the repository root before committing:
#
#   perl tools/sitemap-lastmod.pl
#
use strict; use warnings;
use POSIX qw(strftime);

my $file = 'sitemap.xml';
open my $in, '<:raw', $file or die "$file: $!"; local $/; my $s = <$in>; close $in;
my $today = strftime('%Y-%m-%d', localtime);
my %dirty = map { chomp; s/^...//; $_ => 1 } grep { /\S/ } `git status --porcelain`;

my $n = 0;
$s =~ s{<url>\s*<loc>https://www\.kakderesearch\.com/([^<]*)</loc>(.*?)<lastmod>[^<]*</lastmod>}{
  my ($path, $mid) = ($1, $2);
  my $html = $path eq '' ? 'index.html' : ($path =~ m{/$} ? "${path}index.html" : $path);
  my $date;
  if ($dirty{$html}) { $date = $today; }
  else {
    my $out = `git log -1 --format=%cs -- "$html" 2>/dev/null`; chomp $out;
    $date = $out =~ /^\d{4}-\d{2}-\d{2}$/ ? $out : $today;
  }
  $n++;
  "<url>\n    <loc>https://www.kakderesearch.com/$path</loc>$mid<lastmod>$date</lastmod>"
}sge;
open my $out, '>:raw', $file or die; print $out $s; close $out;
print "dated $n sitemap entries\n";
