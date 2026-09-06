#!/usr/bin/env perl
# Versioned asset URLs. Every same-origin stylesheet, script and data file
# referenced from the HTML gets ?v=<first 10 hex of its SHA-256>, so a
# changed file is a new URL and the long cache lifetime in vercel.json can
# never serve a stale copy. Idempotent: existing ?v= stamps are replaced.
#
#   perl tools/stamp-assets.pl            # from the repository root
#
use strict; use warnings;
use Digest::SHA qw(sha256_hex);
use File::Find;

my @html;
find(sub { push @html, $File::Find::name if /\.html$/ && $File::Find::name !~ m{/(\.git|\.claude|node_modules)/} }, '.');

my %hash;
sub stamp {
  my ($path) = @_;
  return $hash{$path} if exists $hash{$path};
  open my $fh, '<:raw', $path or return ($hash{$path} = undef);
  local $/; my $data = <$fh>; close $fh;
  return ($hash{$path} = substr(sha256_hex($data), 0, 10));
}

my $total = 0;
for my $file (sort @html) {
  open my $in, '<:raw', $file or die "$file: $!"; local $/; my $s = <$in>; close $in;
  (my $dir = $file) =~ s{/[^/]+$}{};
  my $n = 0;
  $s =~ s{((?:href|src)=")((?:\.\./)*)((?:css|js|assets/data)/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")}{
    my ($pre, $up, $rel, $post) = ($1, $2, $3, $4);
    my $abs = "$dir/$up$rel"; $abs =~ s{/[^/]+/\.\./}{/}g while $abs =~ m{/[^/]+/\.\./};
    my $v = stamp($abs);
    $n++ if defined $v;
    defined $v ? "$pre$up$rel?v=$v$post" : "$pre$up$rel$post";
  }ge;
  # absolute references (the 404 page uses them)
  $s =~ s{((?:href|src)=")(/(?:css|js|assets/data)/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")}{
    my ($pre, $rel, $post) = ($1, $2, $3);
    my $v = stamp(".$rel");
    $n++ if defined $v;
    defined $v ? "$pre$rel?v=$v$post" : "$pre$rel$post";
  }ge;
  open my $out, '>:raw', $file or die; print $out $s; close $out;
  $total += $n;
  printf "%-62s %d\n", $file, $n if $n;
}
print "stamped $total references\n";
